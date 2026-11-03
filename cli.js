#!/usr/bin/env node

/**
 * TikTok Live CLI Tool - Assistir Lives do TikTok sem Login
 * Uso:
 *   node cli.js @username
 *   node cli.js username --play
 */

const { getLiveStreamData, normalizeUsername } = require('./stream-resolver');
const { spawn } = require('child_process');
const fs = require('fs');

async function main() {
  const args = process.argv.slice(2);
  const playFlag = args.includes('--play') || args.includes('-p');
  const userArg = args.find(a => !a.startsWith('-'));

  if (!userArg) {
    console.log(`
=============================================================
  TikTok Live Stream Viewer (CLI) - 100% Sem Login
=============================================================
Uso:
  node cli.js <@username ou link> [opções]

Opções:
  --play, -p    Abre automaticamente no VLC se estiver instalado

Exemplos:
  node cli.js @loud_coringa
  node cli.js https://www.tiktok.com/@nobru/live --play
=============================================================
`);
    process.exit(1);
  }

  const username = normalizeUsername(userArg);
  console.log(`\n🔍 Buscando live de @${username} no TikTok sem login...\n`);

  try {
    const data = await getLiveStreamData(username);

    console.log(`-------------------------------------------------------------`);
    console.log(`Canal:      @${data.username} (${data.owner.nickname})`);
    console.log(`Status:     ${data.isLive ? '🔴 AO VIVO (ONLINE)' : '⚪ OFFLINE'}`);
    console.log(`Título:     ${data.title}`);
    console.log(`Sala ID:    ${data.roomId || '-'}`);
    console.log(`Espectadores: ${data.stats.viewerCount}`);
    console.log(`-------------------------------------------------------------`);

    if (!data.isLive) {
      console.log(`ℹ️  O criador @${data.username} não está transmitindo no momento.`);
      if (data.streams.qualities.length > 0) {
        console.log(`\nÚltimos links de stream registrados:`);
      } else {
        process.exit(0);
      }
    }

    console.log(`\n📡 Links de Transmissão em Tempo Real:`);
    if (data.streams.hlsMaster) {
      console.log(`\n[HLS Master (.m3u8)]:`);
      console.log(`  ${data.streams.hlsMaster}`);
    }

    if (Object.keys(data.streams.flvMap).length > 0) {
      console.log(`\n[FLV Streams (.flv)]:`);
      for (const [qual, url] of Object.entries(data.streams.flvMap)) {
        console.log(`  • ${qual}: ${url}`);
      }
    }

    const bestStream = data.streams.bestFlv || data.streams.hlsMaster;

    console.log(`\n💡 Comandos para Assistir Externamente:`);
    console.log(`  VLC:`);
    console.log(`    vlc "${bestStream}" --http-user-agent="Mozilla/5.0" --http-referrer="https://www.tiktok.com/"`);
    console.log(`  MPV:`);
    console.log(`    mpv "${bestStream}" --user-agent="Mozilla/5.0" --referrer="https://www.tiktok.com/"`);

    if (playFlag && bestStream) {
      console.log(`\n🚀 Tentando iniciar player VLC...`);
      const vlcPaths = [
        'vlc',
        'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
        'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
      ];
      let launched = false;
      for (const p of vlcPaths) {
        if (p === 'vlc' || fs.existsSync(p)) {
          try {
            spawn(p, [
              bestStream,
              '--http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              '--http-referrer=https://www.tiktok.com/'
            ], { detached: true, stdio: 'ignore' }).unref();
            console.log(`✅ VLC iniciado!`);
            launched = true;
            break;
          } catch {}
        }
      }
      if (!launched) {
        console.log(`⚠️  VLC não encontrado no caminho padrão. Copie o comando acima para executar.`);
      }
    }

  } catch (err) {
    console.error(`❌ Erro: ${err.message}`);
    process.exit(1);
  }
}

main();
