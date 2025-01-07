import { EC2Client, DescribeInstancesCommand, StopInstancesCommand } from "@aws-sdk/client-ec2";

const API_KEY = 'blah';
const API_SECRET = 'blah';
const DOMAIN = 'harshitanant.dev';
const SUBDOMAIN = 'cv';
const REDIRECT_URL = "https://mycv-redirect.vercel.app";
const config = { region: "ap-south-1" };
const client = new EC2Client(config);
const input = { InstanceIds: ["i-blah"], IncludeAllInstances: true }; // important to have this boolean value true

// just a helper function for Porkbun API calls
const fetchPorkbun = async (url, body) => {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            apikey: API_KEY,
            secretapikey: API_SECRET,
            ...body,
        }),
    });
};

export const handler = async (event) => {
    try {
        const instanceDetails = await getInstance();
        const instanceStatus = instanceDetails.State.Name;
        console.log(`Instance status is: ${instanceStatus}`); // "pending" || "running" || "shutting-down" || "terminated" || "stopping" || "stopped"

        // had to put this here because I don't want to have any errors because of porkbun
        const urlForward = await checkUrlForward();
        await deleteDNSRecord(); // just in case if there was any error in deleting the DNS record previously
        if (urlForward && urlForward.location === REDIRECT_URL) {
            // do nothing
        } else {
            await deleteUrlForward();
            await addUrlForward();
        }

        if (instanceStatus === "stopped" || instanceStatus === "stopping") {
            return {
                statusCode: 200,
                body: JSON.stringify(`Instance is already stopped or in the process of stopping.`),
            };
        } else {
            await stopInstance();
            return {
                statusCode: 200,
                body: JSON.stringify(`Instance stopping, URL forwarding added, and DNS record deleted.`),
            };
        }
    } catch (error) {
        console.error(`Error: ${error}`);
        return {
            statusCode: 500,
            body: JSON.stringify(`An error happened. Please check logs.`),
        };
    }
};

const getInstance = async () => {
    try {
        const command = new DescribeInstancesCommand(input);
        const data = await client.send(command);
        const instanceDetails = data.Reservations[0].Instances[0];
        return instanceDetails;
    } catch (error) {
        console.error('Error in getting instance:', error);
        throw error;
    }
};

const stopInstance = async () => {
    try {
        const command = new StopInstancesCommand(input);
        const response = await client.send(command);

        const currentState = response.StoppingInstances[0].CurrentState.Name;
        console.log(`Instance is now: ${currentState}`);

        return { statusCode: 200, body: JSON.stringify(`Instance is stopping now.`) };
    } catch (error) {
        console.error('Error in stopping instance:', error);
        throw error;
    }
};

const deleteDNSRecord = async () => {
    try {
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/dns/deleteByNameType/${DOMAIN}/A/${SUBDOMAIN}`);
        const data = await response.json();
        console.log('DNS Delete Response:', data);
        return data;
    } catch (error) {
        console.error('Error in deleting DNS record:', error);
        throw error;
    }
};

const addUrlForward = async () => {
    try {
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/domain/addUrlForward/${DOMAIN}`, {
            subdomain: SUBDOMAIN,
            location: REDIRECT_URL,
            type: 'temporary',
            includePath: 'no',
            wildcard: 'no',
        });

        const data = await response.json();
        console.log('URL Forward Add Response:', data);
        return data;
    } catch (error) {
        console.error('Error in adding URL forward:', error);
        throw error;
    }
};

const checkUrlForward = async () => {
    try {
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/domain/getUrlForwarding/${DOMAIN}`);
        const data = await response.json();
        console.log('URL Forwarding Response:', data);

        const forwards = data.forwards || [];
        const forwardExists = forwards.some(forward => forward.subdomain === SUBDOMAIN);

        if (forwardExists) {
            return forwards[0];
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error in checking URL forward:', error);
        return null;
    }
};

const deleteUrlForward = async () => {
    try {
        const urlForward = await checkUrlForward();
        if (urlForward) {
            const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/domain/deleteUrlForward/${DOMAIN}/${urlForward.id}`);
            const deleteData = await response.json();
            console.log('URL Forward Delete Response:', deleteData);
            return deleteData;
        }
    } catch (error) {
        console.error('Error in deleting URL forward:', error);
        throw error;
    }
};