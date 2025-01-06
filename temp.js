const DOMAIN = 'harshitanant.dev';
const SUBDOMAIN = 'cv';
const GET_IPV4_API_URL = `https://dns.google.com/resolve?name=${SUBDOMAIN}.${DOMAIN}&type=A`;

const getIPv4Address = async () => {
    try {
        const response = await fetch(GET_IPV4_API_URL);
        if (!response.ok) {
            throw new Error('Failed to fetch the IP address');
        }

        const data = await response.json();
        console.log(data); 

        const ipAddress = data.Answer?.[0]?.data; 

        if (ipAddress) {
            return ipAddress;
        } else {
            throw new Error('DNS IP address not found');
        }
    } catch (error) {
        console.error('An error occurred while fetching DNS IP address:', error);
        return null;
    }
};

// Example usage
getIPv4Address().then(ip => console.log('IP Address:', ip));
