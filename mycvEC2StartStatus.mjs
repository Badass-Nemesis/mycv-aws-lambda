import { EC2Client, DescribeInstancesCommand, StartInstancesCommand } from "@aws-sdk/client-ec2";
import dns from 'node:dns';

const API_KEY = 'blah';
const API_SECRET = 'blah';
const DOMAIN = 'harshitanant.dev';
const SUBDOMAIN = 'cv'
const config = { region: "ap-south-1" };
const client = new EC2Client(config);
const input = { InstanceIds: ["i-blah"], IncludeAllInstances: true }; // important to have this boolean value true
const command = new DescribeInstancesCommand(input);

export const handler = async (event) => {
    try {
        const instanceDetails = await getInstance();
        const instanceStatus = instanceDetails.State.Name;
        console.log(`Instance staus is : ${instanceStatus}`); //"pending" || "running" || "shutting-down" || "terminated" || "stopping" || "stopped"

        if (instanceStatus === "stopped") {
            // await startInstance();
            // return { statusCode: 200, body: JSON.stringify(`The instance is starting now`) };
            return (await startInstance());
        } else if (instanceStatus === "running") {
            const ipAddress = await getInstancePublicIPv4();
            const currentSiteIpAddress = await getIPv4Address();

            if (ipAddress === currentSiteIpAddress) {
                // do nothing
                return { statusCode: 200, body: JSON.stringify(`The instance is running already.`) };
            } else {
                await checkAndDeleteUrlForward();
                await createDNSRecord(ipAddress);

                return { statusCode: 200, body: JSON.stringify(`The instance is initializing now. And DNS record has been updated from ${currentSiteIpAddress} to ${ipAddress}`) };
            }
        } else {
            return { statusCode: 200, body: JSON.stringify(`I don't know what is happening, but here's the isntance status : ${instanceStatus}`) };
        }
    } catch (error) {
        console.log(`Error: ${error}`);
        return { statusCode: 500, body: JSON.stringify(`An error happened in handler function. Please check logs.`) };
    }
}

const getInstance = async () => {
    try {
        const data = await client.send(command);
        const instanceDetails = data.Reservations[0].Instances[0];
        return instanceDetails;
    } catch (error) {
        console.error('Error in getting instance :', error);
        return null;
    }
}

const getInstancePublicIPv4 = async () => {
    try {
        const data = await client.send(command);
        const instanceDetails = data.Reservations[0].Instances[0];
        const publicIPv4 = instanceDetails.PublicIpAddress;
        return publicIPv4;
    } catch (error) {
        console.error('Error in getting public ipv4 of the instance:', error);
        return null;
    }
}

const startInstance = async () => {
    try {
        const command = new StartInstancesCommand(input);
        const response = await client.send(command);

        const previousState = response.StartingInstances[0].PreviousState.Name;
        console.log(`Previous state of the instance was: ${previousState}`)

        const currentState = response.StartingInstances[0].CurrentState.Name;
        console.log(`Current state of the instance is : ${currentState}`);

        return { statusCode: 200, body: JSON.stringify(`The instance is starting now`) };
    } catch (error) {
        // this is probably gonna be EC2ServiceException
        console.log(`An error happened. Here are the details : ${error}`);
        return { statusCode: 500, body: JSON.stringify(`An error happened in starting the instance. Please check logs.`) };
    }
}

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

const createDNSRecord = async (ipAddress) => {
    try {
        await deleteDNSRecord(); // first delete the current one else it'll cause error

        const response = await fetch(`https://api.porkbun.com/api/json/v3/dns/create/${DOMAIN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: API_KEY,
                secretapikey: API_SECRET,
                name: SUBDOMAIN,
                type: "A",
                content: ipAddress,
                ttl: 60, // need to change this TTL to less seconds
            })
        });

        const dnsData = await response.json();
        console.log('DNS Create Response:', dnsData);
        return dnsData;
    } catch (error) {
        console.log(`An error happened. Here are the details: ${error}`);
        return { statusCode: 500, body: JSON.stringify(`An error happened in creating the DNS record. Please check logs.`) };
    }
};

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

        const dnsData = await response.json();
        console.log('DNS Delete Response:', dnsData);
        return dnsData;
    } catch (error) {
        console.log(`An error happened. Here are the details: ${error}`);
        return { statusCode: 500, body: JSON.stringify(`An error happened in deleting the DNS record. Please check logs.`) };
    }
}

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

const getIPv4Address = async () => {
    return new Promise((resolve, reject) => {
        dns.lookup(`${SUBDOMAIN}.${DOMAIN}`, (err, address, family) => {
            if (err) {
                reject(err);
            } else if (family === 4) {
                resolve(address);
            } else {
                reject(new Error('Address is not IPv4'));
            }
        })
    })
};