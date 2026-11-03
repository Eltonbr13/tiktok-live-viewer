const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com';

async function githubRequest(url, method, token, body = null) {
  const headers = {
    'User-Agent': 'TikTok-Live-Viewer-Deployer',
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

function getAllFiles(dir, baseDir = dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    if (item === 'node_modules' || item === '.git' || item.endsWith('.zip') || item === 'functions' || item === '.firebase') {
      continue;
    }
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, baseDir));
    } else {
      results.push({
        fullPath,
        relPath: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
      });
    }
  }
  return results;
}

async function deployToGitHub(token, repoName = 'tiktok-live-viewer') {
  console.log('1. Verificando autenticação no GitHub...');
  const userRes = await githubRequest(`${GITHUB_API}/user`, 'GET', token);
  if (!userRes.ok) {
    throw new Error(`Token inválido ou sem permissão. Status: ${userRes.status} (${userRes.data?.message || 'Unauthorized'})`);
  }
  const username = userRes.data.login;
  console.log(`✓ Autenticado como: @${username}`);

  console.log(`2. Verificando/Criando repositório '${repoName}'...`);
  let repoRes = await githubRequest(`${GITHUB_API}/repos/${username}/${repoName}`, 'GET', token);
  if (!repoRes.ok) {
    // Create repo
    repoRes = await githubRequest(`${GITHUB_API}/user/repos`, 'POST', token, {
      name: repoName,
      description: 'TikTok Live Stream Viewer - 100% Sem Login e Tempo Real',
      private: false,
      auto_init: true,
    });
    if (!repoRes.ok) {
      throw new Error(`Falha ao criar repositório: ${repoRes.data?.message || repoRes.status}`);
    }
    console.log(`✓ Repositório criado com sucesso: ${repoRes.data.html_url}`);
    // Wait 2 seconds for git tree init
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    console.log(`✓ Repositório existente encontrado: ${repoRes.data.html_url}`);
  }

  const projectDir = __dirname;
  const files = getAllFiles(projectDir);
  console.log(`3. Enviando ${files.length} arquivos para o GitHub...`);

  for (const file of files) {
    const content = fs.readFileSync(file.fullPath).toString('base64');
    
    // Check if file already exists to get SHA
    const existingFileRes = await githubRequest(
      `${GITHUB_API}/repos/${username}/${repoName}/contents/${file.relPath}`,
      'GET',
      token
    );

    const payload = {
      message: `Deploy: ${file.relPath}`,
      content,
    };
    if (existingFileRes.ok && existingFileRes.data?.sha) {
      payload.sha = existingFileRes.data.sha;
    }

    const uploadRes = await githubRequest(
      `${GITHUB_API}/repos/${username}/${repoName}/contents/${file.relPath}`,
      'PUT',
      token,
      payload
    );

    if (uploadRes.ok) {
      console.log(`   + ${file.relPath}`);
    } else {
      console.error(`   x Erro em ${file.relPath}: ${uploadRes.data?.message}`);
    }
  }

  console.log('\n======================================================');
  console.log(`🎉 Deploy concluído no GitHub!`);
  console.log(`URL do repositório: https://github.com/${username}/${repoName}`);
  console.log('======================================================');
  return `https://github.com/${username}/${repoName}`;
}

module.exports = { deployToGitHub };

if (require.main === module) {
  const token = process.argv[2] || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Uso: node github-deploy.js <SEU_GITHUB_TOKEN>');
    process.exit(1);
  }
  deployToGitHub(token).catch((err) => {
    console.error('Erro no deploy:', err.message);
    process.exit(1);
  });
}
