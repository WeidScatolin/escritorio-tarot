import { spawn } from 'node:child_process';

export type FfmpegOptions = {
  bin?: string;
  /** Só para testes: substitui os argumentos padrão. */
  args?: string[];
  timeoutMs?: number;
};

// mp3 (stdin) -> ogg/opus mono 48 kHz (stdout): o formato da nota de voz do WhatsApp.
const DEFAULT_ARGS = [
  '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn',
  '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000', '-f', 'ogg', 'pipe:1',
];
const DEFAULT_TIMEOUT_MS = 30_000;

export function mp3ToOggOpus(mp3: Buffer, opts: FfmpegOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.bin ?? 'ffmpeg', opts.args ?? DEFAULT_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('ffmpeg: tempo esgotado na conversão')));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    }

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', () => finish(() => reject(new Error('ffmpeg: não foi possível executar (instalado na imagem?)'))));
    child.on('close', (code) => {
      if (code === 0) return finish(() => resolve(Buffer.concat(out)));
      const detail = Buffer.concat(err).toString().trim().slice(0, 200);
      finish(() => reject(new Error(`ffmpeg saiu com código ${code}${detail ? `: ${detail}` : ''}`)));
    });
    // Se o processo morrer antes de ler tudo, o erro vem pelo 'close' acima.
    child.stdin.on('error', () => undefined);
    child.stdin.end(mp3);
  });
}
