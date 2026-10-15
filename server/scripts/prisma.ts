import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const offline = ['generate', 'validate', 'format'].includes(args[0] ?? '');
if (!process.env.MONGODB_URI && !offline) {
  console.error('Configure MONGODB_URI no .env antes de executar este comando.');
  process.exit(1);
}
try {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/staypulse';
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('prisma/build/index.js')), ...args], {
    stdio: 'inherit', env: { ...process.env, MONGODB_URI: uri },
  });
  process.exitCode = result.status ?? 1;
} catch {
  console.error('Não foi possível configurar o Prisma. Verifique MONGODB_URI.');
  process.exitCode = 1;
}
