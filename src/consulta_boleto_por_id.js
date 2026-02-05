// consulta_boleto_por_id.js
// Uso: node consulta_boleto_por_id.js
//nao mexer, pois esta funcionando

const axios = require('axios');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const {
  CORA_API_BASE_URL,
  CORA_CLIENT_ID,
  CORA_PRIVATE_KEY_PASSPHRASE,
  CORACERT,
  CORAKEY,
  CORA_CERT_FOLDER_PATH,
  CORA_CERT_FILENAME,
  CORA_KEY_FILENAME
} = process.env;

const invoiceId = "inv_GBbAMXrpS90u5cbMB2Kig8w";
if (!invoiceId) {
  console.error('❌ Informe o ID do invoice: node consulta_boleto_por_id.js <INVOICE_ID>');
  process.exit(1);
}
if (!CORA_API_BASE_URL || !CORA_CLIENT_ID) {
  console.error('❌ Defina CORA_API_BASE_URL e CORA_CLIENT_ID no .env');
  process.exit(1);
}

const certFilename = CORA_CERT_FILENAME || 'certificate.pem';
const keyFilename = CORA_KEY_FILENAME || 'private_key.pem';

async function loadPem(envVal, folder, filename, friendlyName) {
  // Prioriza arquivo em disco se folder informado
  if (folder) {
    const p = path.join(folder, filename);
    try {
      console.log(`🔑 Lendo ${friendlyName} de arquivo: ${p}`);
      return await fs.readFile(p);
    } catch (e) {
      console.warn(`⚠️ Não leu ${p}: ${e.message} — tentando variável de ambiente...`);
    }
  }

  if (!envVal) {
    throw new Error(`${friendlyName} não encontrado em arquivo nem em variável de ambiente`);
  }

  let val = String(envVal).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (val.includes('\\n')) {
    val = val.replace(/\\n/g, '\n');
  }
  if (val.includes('-----BEGIN')) {
    return Buffer.from(val, 'utf8');
  }
  // tenta decodificar base64
  const candidate = val.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(candidate)) {
    try {
      const buf = Buffer.from(candidate, 'base64');
      return buf;
    } catch (e) {
      // fallback
    }
  }
  return Buffer.from(val, 'utf8');
}

async function createAgent() {
  const cert = await loadPem(CORACERT, CORA_CERT_FOLDER_PATH, certFilename, 'certificado (CORACERT)');
  const key = await loadPem(CORAKEY, CORA_CERT_FOLDER_PATH, keyFilename, 'chave privada (CORAKEY)');
  try {
    const keyStr = key.toString('utf8');
    if (keyStr.includes('ENCRYPTED')) {
      console.warn('🔐 A chave privada parece ENCRYPTED; confirme CORA_PRIVATE_KEY_PASSPHRASE');
    }
  } catch (e) {}
  return new https.Agent({
    cert,
    key,
    passphrase: CORA_PRIVATE_KEY_PASSPHRASE || undefined,
    rejectUnauthorized: true
  });
}

async function getAccessToken(agent) {
  const tokenUrl = `${CORA_API_BASE_URL.replace(/\/$/, '')}/token`;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: CORA_CLIENT_ID }).toString();
  const resp = await axios.post(tokenUrl, body, {
    httpsAgent: agent,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });
  return resp.data.access_token;
}

(async () => {
  try {
    const agent = await createAgent();
    console.log('✅ HTTPS agent pronto');
    const token = await getAccessToken(agent);
    console.log('✅ Token obtido');

    const url = `${CORA_API_BASE_URL.replace(/\/$/, '')}/v2/invoices/${invoiceId}`;
    console.log(`📡 GET ${url}`);
    const resp = await axios.get(url, {
      httpsAgent: agent,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000
    });

    console.log(`\n📥 Status: ${resp.status}\n`);
    console.log('===== JSON COMPLETO DO DETALHE =====');
    console.log(JSON.stringify(resp.data, null, 2));
    console.log('===== FIM =====\n');
  } catch (err) {
    console.error('❌ Erro:', err.message);
    if (err.response) {
      console.error('📄 Status:', err.response.status);
      console.error('📄 Body:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
})();
