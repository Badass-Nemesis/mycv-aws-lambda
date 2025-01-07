import { EC2Client, DescribeInstancesCommand, StartInstancesCommand } from "@aws-sdk/client-ec2";
import dns from 'node:dns';

const API_KEY = 'blah';
const API_SECRET = 'blah';
const DOMAIN = 'blah.dev';
const SUBDOMAIN = 'blah';
const config = { region: "ap-south-1" };
const client = new EC2Client(config);
const input = { InstanceIds: ["i-blah"], IncludeAllInstances: true };
const command = new DescribeInstancesCommand(input);

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
        console.log(`Instance status is: ${instanceStatus}`);

        if (instanceStatus === "stopped") {
            return await startInstance();
        } else if (instanceStatus === "running") {

            // did this all so that if it fails then at least the bottom code block will run and call the porkbun api
            const [ipAddressResult, currentSiteIpAddressResult] = await Promise.allSettled([
                getInstancePublicIPv4(),
                getIPv4Address(),
            ]);
            const ipAddress = ipAddressResult.status === 'fulfilled' ? ipAddressResult.value : null;
            const currentSiteIpAddress = currentSiteIpAddressResult.status === 'fulfilled' ? currentSiteIpAddressResult.value : null;

            if (ipAddress && currentSiteIpAddress && (ipAddress === currentSiteIpAddress)) {
                return { statusCode: 200, body: JSON.stringify(`The instance is running already.`) };
            } else {
                await Promise.all([
                    checkAndDeleteUrlForward(),
                    createDNSRecord(ipAddress),
                ]);

                return {
                    statusCode: 200,
                    body: JSON.stringify(`The instance is initializing now. DNS record has been updated from ${currentSiteIpAddress || 'N/A'} to ${ipAddress || 'N/A'}`),
                };
            }
        } else {
            return { statusCode: 200, body: JSON.stringify(`I don't know what is happening, but here's the instance status: ${instanceStatus}`) };
        }
    } catch (error) {
        console.error(`Error in handler function:`, error.stack || error);
        return { statusCode: 500, body: JSON.stringify(`An error happened in the handler function. Please check logs.`) };
    }
};

const getInstance = async () => {
    try {
        const data = await client.send(command);
        return data.Reservations[0].Instances[0];
    } catch (error) {
        console.error('Error in getting instance:', error);
        throw error;
    }
};

const getInstancePublicIPv4 = async () => {
    const instanceDetails = await getInstance();
    return instanceDetails.PublicIpAddress;
};

const startInstance = async () => {
    try {
        const command = new StartInstancesCommand(input);
        const response = await client.send(command);

        const previousState = response.StartingInstances[0].PreviousState.Name;
        console.log(`Previous state of the instance was: ${previousState}`);

        const currentState = response.StartingInstances[0].CurrentState.Name;
        console.log(`Current state of the instance is: ${currentState}`);

        return { statusCode: 200, body: JSON.stringify(`The instance is starting now`) };
    } catch (error) {
        console.error(`Error in starting instance:`, error);
        return { statusCode: 500, body: JSON.stringify(`An error happened in starting the instance. Please check logs.`) };
    }
};

const createDNSRecord = async (ipAddress) => {
    try {
        await deleteDNSRecord();
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/dns/create/${DOMAIN}`, {
            name: SUBDOMAIN,
            type: "A",
            content: ipAddress,
            ttl: 60,
        });

        const dnsData = await response.json();
        console.log('DNS Create Response:', dnsData);
        return dnsData;
    } catch (error) {
        console.error(`Error in creating DNS record:`, error);
        throw error;
    }
};

const deleteDNSRecord = async () => {
    try {
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/dns/deleteByNameType/${DOMAIN}/A/${SUBDOMAIN}`);
        const dnsData = await response.json();
        console.log('DNS Delete Response:', dnsData);
        return dnsData;
    } catch (error) {
        console.error(`Error in deleting DNS record:`, error);
        throw error;
    }
};

const checkAndDeleteUrlForward = async () => {
    try {
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/domain/getUrlForwarding/${DOMAIN}`);
        const data = await response.json();
        console.log('URL Forwarding Response:', data);

        const forwards = data.forwards || [];
        const forwardExists = forwards.some(forward => forward.subdomain === SUBDOMAIN);

        if (forwardExists) {
            await deleteUrlForward(forwards[0].id);
            return { statusCode: 200, body: JSON.stringify(`Successfully found the URL forward and deleted it.`) };
        } else {
            return { statusCode: 200, body: JSON.stringify(`No URL forwards were found for subdomain: ${SUBDOMAIN}`) };
        }
    } catch (error) {
        console.error(`Error in checking and deleting URL forward:`, error);
        throw error;
    }
};

const deleteUrlForward = async (recordId) => {
    try {
        const response = await fetchPorkbun(`https://api.porkbun.com/api/json/v3/domain/deleteUrlForward/${DOMAIN}/${recordId}`);
        const deleteData = await response.json();
        console.log('URL Forward Delete Response:', deleteData);
        return deleteData;
    } catch (error) {
        console.error(`Error in deleting URL forward:`, error);
        throw error;
    }
};

const getIPv4Address = async () => {
    try {
        const hostname = `${SUBDOMAIN}.${DOMAIN}`;
        const addresses = await new Promise((resolve, reject) => {
            dns.resolve4(hostname, (err, addresses) => {
                if (err) {
                    console.error('An error occurred while resolving DNS:', err);
                    reject(new Error('Failed to fetch the IP address'));
                } else {
                    resolve(addresses[0]);
                }
            });
        });
        return addresses;
    } catch (error) {
        console.error('Error in fetching IPv4 address from DNS:', error);
        return null;
    }
};