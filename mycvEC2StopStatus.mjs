import { EC2Client, DescribeInstancesCommand, StopInstancesCommand } from "@aws-sdk/client-ec2";

const API_KEY = 'blah';
const API_SECRET = 'blah';
const DOMAIN = 'harshitanant.dev';
const SUBDOMAIN = 'cv'
const REDIRECT_URL = "https://porkbun.com"
const config = { region: "ap-south-1" };
const client = new EC2Client(config);
const input = { InstanceIds: ["i-blah"], IncludeAllInstances: true }; // important to have this boolean value Xtrue

export const handler = async (event) => {
    try {
        const instanceDetails = await getInstance();
        const instanceStatus = instanceDetails.State.Name;
        console.log(`Instance status is: ${instanceStatus}`); //"pending" || "running" || "shutting-down" || "terminated" || "stopping" || "stopped"

        await checkAndDeleteUrlForward();
        await deleteDNSRecord();
        await addUrlForward();

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
        return null;
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
        return { statusCode: 500, body: JSON.stringify(`An error happened in stopping the instance. Please check logs.`) };
    }
};

// const ping = async () => {
//     try {
//         const response = await fetch('https://api.porkbun.com/api/json/v3/ping', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 apikey: API_KEY,
//                 secretapikey: API_SECRET
//             })
//         });

//         const data = await response.json();
//         console.log('Ping response: ', data);
//         return data;
//     } catch (error) {
//         console.log(`An error happened. Here are the details: ${error}`);
//         return { statusCode: 500, body: JSON.stringify(`An error happened in getting ping. Please check logs.`) };
//     }
// }

const deleteDNSRecord = async () => {
    try {
        const response = await fetch(`https://api.porkbun.com/api/json/v3/dns/deleteByNameType/${DOMAIN}/A/${SUBDOMAIN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: API_KEY,
                secretapikey: API_SECRET,
            })
        });

        const data = await response.json();
        console.log('DNS Delete Response:', data);
        return data;
    } catch (error) {
        console.error('Error in deleting DNS record:', error);
        return { statusCode: 500, body: JSON.stringify(`An error happened in deleting the DNS record. Please check logs.`) };
    }
};

const addUrlForward = async () => {
    try {
        const response = await fetch(`https://api.porkbun.com/api/json/v3/domain/addUrlForward/${DOMAIN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: API_KEY,
                secretapikey: API_SECRET,
                subdomain: SUBDOMAIN,
                location: REDIRECT_URL,
                type: 'temporary',
                includePath: 'no',
                wildcard: 'yes'
            })
        });

        const data = await response.json();
        console.log('URL Forward Add Response:', data);
        return data;
    } catch (error) {
        console.error('Error in adding URL forward:', error);
        return { statusCode: 500, body: JSON.stringify(`An error happened in adding the URL forward. Please check logs.`) };
    }
};

const checkAndDeleteUrlForward = async () => {
    const url = `https://api.porkbun.com/api/json/v3/domain/getUrlForwarding/${DOMAIN}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: API_KEY,
                secretapikey: API_SECRET
            })
        });

        const data = await response.json();
        console.log('URL Forwarding Response:', data);

        const forwards = data.forwards || [];
        const forwardExists = forwards.some(forward => forward.subdomain === SUBDOMAIN);

        if (forwardExists) {
            await deleteUrlForward(forwards[0].id);
            return { statusCode: 200, body: JSON.stringify(`Successfully found the URL forward and deleted it.`) }
        } else {
            return { statusCode: 200, body: JSON.stringify(`No URL forwards were found for subdomain: ${SUBDOMAIN}`) }
        }
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: JSON.stringify(`An error happened in getting and deleting the URL forwarding. Please check logs.`) };
    }
};

const deleteUrlForward = async (recordId) => {
    try {
        const response = await fetch(`https://api.porkbun.com/api/json/v3/domain/deleteUrlForward/${DOMAIN}/${recordId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: API_KEY,
                secretapikey: API_SECRET,
            })
        });

        const deleteData = await response.json();
        console.log('URL Forward Delete Response:', deleteData);
        return deleteData;
    } catch (error) {
        console.log(`An error happened. Here are the details: ${error}`);
        return { statusCode: 500, body: JSON.stringify(`An error happened in deleting the URL forward. Please check logs.`) };
    }
};