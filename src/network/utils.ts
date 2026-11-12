// Network utility functions

/**
 * Validates and normalizes an IP address string
 * Returns normalized IP or null if invalid
 */
export function normalizeIP(ip: string): string | null {
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return null;

    if (parts.some(p => !/^\d{1,3}$/.test(p))) return null;
    const octets = parts.map(Number);
    if (octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;

    return octets.join('.');
}

/**
 * Converts IP string to 32-bit number
 */
export function ipToNumber(ip: string): number {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Converts 32-bit number to IP string
 */
export function numberToIP(num: number): string {
    return [
        (num >>> 24) & 0xFF,
        (num >>> 16) & 0xFF,
        (num >>> 8) & 0xFF,
        num & 0xFF
    ].join('.');
}

/**
 * Calculates network address from IP and subnet mask
 */
export function getNetworkAddress(ip: string, subnetMask: string): string {
    const ipNum = ipToNumber(ip);
    const maskNum = ipToNumber(subnetMask);
    return numberToIP((ipNum & maskNum) >>> 0);
}

/**
 * Calculates broadcast address from IP and subnet mask
 */
export function getBroadcastAddress(ip: string, subnetMask: string): string {
    const ipNum = ipToNumber(ip);
    const maskNum = ipToNumber(subnetMask);
    const invMask = (~maskNum) >>> 0;
    return numberToIP(((ipNum & maskNum) | invMask) >>> 0);
}

/**
 * Checks if two IPs are in the same network
 */
export function sameNetwork(ip1: string, ip2: string, subnetMask: string): boolean {
    return getNetworkAddress(ip1, subnetMask) === getNetworkAddress(ip2, subnetMask);
}

/**
 * Validates subnet mask
 */
export function isValidSubnetMask(mask: string): boolean {
    if (!normalizeIP(mask)) return false;
    const num = ipToNumber(mask);
    // Valid subnet masks are contiguous 1s followed by 0s
    // e.g., 11111111.11111111.11111111.00000000
    if (num === 0) return true;
    const inverted = (~num) >>> 0;
    return (inverted & (inverted + 1)) === 0;
}

/**
 * Generates a random MAC address
 */
export function generateMAC(): string {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    // First byte: set locally administered bit, clear multicast bit
    const firstByte = (Math.floor(Math.random() * 256) & 0xFE | 0x02).toString(16).padStart(2, '0').toUpperCase();
    return `${firstByte}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
}

/**
 * Validates MAC address format
 */
export function isValidMAC(mac: string): boolean {
    return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac);
}

/**
 * Normalizes MAC address to uppercase with colons
 */
export function normalizeMAC(mac: string): string {
    return mac.replace(/[:-]/g, ':').toUpperCase();
}

export const BROADCAST_MAC = 'FF:FF:FF:FF:FF:FF';
export const BROADCAST_IP = '255.255.255.255';

/** Strict router firewall patterns; malformed strings must never become partial matches. */
export function isValidIPPattern(pattern: unknown): pattern is string {
    if (pattern === 'any') return true;
    if (typeof pattern !== 'string') return false;
    const parts = pattern.split('/');
    return parts.length <= 2 && normalizeIP(parts[0]) !== null && (parts.length === 1 || /^\d{1,2}$/.test(parts[1]) && Number(parts[1]) <= 32);
}
export function isValidPortPattern(pattern: unknown): boolean {
    if (pattern === undefined || pattern === '') return true;
    if (typeof pattern !== 'string' || !/^\d{1,5}(-\d{1,5})?$/.test(pattern)) return false;
    const [start,end = start] = pattern.split('-').map(Number);
    return start >= 1 && end <= 65535 && start <= end;
}
