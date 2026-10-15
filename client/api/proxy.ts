import { env } from 'node:process';
import { proxyRequest } from '../server/vercel-proxy.js';

export const GET = (request: Request) => proxyRequest(request, env);
export const POST = (request: Request) => proxyRequest(request, env);
