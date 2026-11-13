/* Client factory + capability helpers */
import { QBittorrentClient } from './qbittorrent.js';
import { TransmissionClient } from './transmission.js';

const cache = new Map();
const sig = (s) => [s.id, s.type, s.address, s.port, s.useHTTPS, s.rpcPath, s.username, s.password, s.allowInsecureSSL].join('|');

export function getClient(server) {
  const key = sig(server);
  const hit = cache.get(server.id);
  if (hit && hit.key === key) return hit.client;
  const client = server.type === 'tr' ? new TransmissionClient(server) : new QBittorrentClient(server);
  cache.set(server.id, { key, client });
  return client;
}
export function invalidateClients() { cache.clear(); }

/** Capability matrix — mirrors "Available actions vary by downloader type" in OiiQT. */
export function caps(server) {
  const qb = server?.type !== 'tr';
  return {
    qb, categories: qb, trackerEdit: true, peers: qb,
    sequential: qb, firstLastPrio: qb, speedLimit: true, location: true, rename: true,
    setShareLimits: true, torrentFile: true
  };
}

/** Normalize a KB/s value from the UI into the unit the client expects. */
export function speedArg(server, kbps) {
  return server?.type === 'tr' ? Number(kbps) : Number(kbps) * 1024;
}
