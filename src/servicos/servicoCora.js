// src/services/coraService.js
const axios = require('axios');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const querystring = require('querystring');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

class CoraService {
  constructor() {
    this.httpsAgent = null;
    this.token = null;
    this.tokenExpiry = null;
    // Lê diretamente do .env
    this.apiBaseUrl = process.env.CORA_API_BASE_URL;
    this.clientId = process.env.CORA_CLIENT_ID;
    const raw = process.env.CORA_PRIVATE_KEY_PASSPHRASE;
    this.privateKeyPassphrase = (raw && raw !== 'NONE' && raw.trim() !== '') ? raw : undefined;
    this.certEnvVar = process.env.CORACERT;
    this.keyEnvVar = process.env.CORAKEY;
    this.certFolderPath = process.env.CORA_CERT_FOLDER_PATH; // ex: C:/node/...
    this.certificateFilename = process.env.CORA_CERT_FILENAME || 'certificate.pem';
    this.privateKeyFilename = process.env.CORA_KEY_FILENAME || 'private_key.pem';

    // Validações básicas
    if (!this.apiBaseUrl || !this.clientId) {
      console.error('❌ Variáveis de ambiente CORA_API_BASE_URL ou CORA_CLIENT_ID não definidas.');
      throw new Error('Configurações essenciais da Cora API estão faltando.');
    }
    if (!this.certEnvVar && !this.certFolderPath) {
      console.error('❌ Nenhuma fonte definida para o certificado (CORACERT ou CORA_CERT_FOLDER_PATH).');
      throw new Error('Configuração do certificado da Cora API está faltando.');
    }
    if (!this.keyEnvVar && !this.certFolderPath) {
      console.error('❌ Nenhuma fonte definida para a chave privada (CORAKEY ou CORA_CERT_FOLDER_PATH).');
      throw new Error('Configuração da chave privada da Cora API está faltando.');
    }
  }

  /**
   * Carrega certificado/chave com prioridade para arquivo em disco (se folder definido).
   * Normaliza conteúdo vindo da env (remove aspas, converte "\n", tenta base64).
   */
  async _loadCertOrKeyContent(type) {
    let content = null;
    let source = 'desconhecida';
    const envVarContent = (type === 'cert') ? this.certEnvVar : this.keyEnvVar;
    const filename = (type === 'cert') ? this.certificateFilename : this.privateKeyFilename;
    const typeName = (type === 'cert') ? 'certificado' : 'chave privada';

    // 1) Prioriza leitura do arquivo em disco se houver pasta configurada
    if (this.certFolderPath) {
      const filePath = path.join(this.certFolderPath, filename);
      try {
        console.log(`🔑 Tentando ler ${typeName} do arquivo: ${filePath}`);
        content = await fs.readFile(filePath);
        source = `arquivo (${filePath})`;
      } catch (fileError) {
        console.warn(`⚠️ Erro ao ler ${typeName} do arquivo ${filePath}: ${fileError.message}. Tentando variável de ambiente...`);
      }
    }

    // 2) Se não encontrou arquivo, usa variável de ambiente (normalizando)
    if (!content && envVarContent) {
      console.log(`🔑 Usando conteúdo do ambiente para ${typeName}. Normalizando...`);
      let val = String(envVarContent).trim();

      // remove aspas externas se houver
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
        console.log('   -> Removidas aspas externas.');
      }

      // converte literais "\n" em quebras reais
      if (val.includes('\\n')) {
        val = val.replace(/\\n/g, '\n');
        console.log('   -> Convertidos literais \\n em quebras de linha.');
      }

      // se contém header PEM, retorna como utf8 buffer
      if (val.includes('-----BEGIN')) {
        content = Buffer.from(val, 'utf8');
        source = `variável de ambiente (CORA${type.toUpperCase()})`;
      } else {
        // tenta detectar base64
        const maybeBase64 = val.replace(/\s+/g, '');
        const base64Regex = /^[A-Za-z0-9+/=]+$/;
        if (base64Regex.test(maybeBase64)) {
          try {
            const buf = Buffer.from(maybeBase64, 'base64');
            content = buf;
            source = `variável de ambiente (CORA${type.toUpperCase()}) base64-decoded`;
            if (buf.toString('utf8').includes('-----BEGIN')) {
              console.log('   -> Base64 decodificado revelou PEM.');
            }
          } catch (e) {
            console.warn('   -> Falha ao decodificar base64. Tratando como UTF-8 simples.');
            content = Buffer.from(val, 'utf8');
            source = `variável de ambiente (CORA${type.toUpperCase()})`;
          }
        } else {
          // fallback: tratar como utf8
          content = Buffer.from(val, 'utf8');
          source = `variável de ambiente (CORA${type.toUpperCase()})`;
        }
      }
    }

    if (!content) {
      throw new Error(`Não foi possível carregar o ${typeName}. Nenhuma fonte válida encontrada (arquivo ou variável de ambiente).`);
    }
    console.log(`✅ ${typeName} carregado com sucesso de: ${source}`);
    return content;
  }

  async createHttpsAgent() {
    if (this.httpsAgent) return this.httpsAgent;
    try {
      const cert = await this._loadCertOrKeyContent('cert');
      const key = await this._loadCertOrKeyContent('key');

      // verificação rápida se chave parece encriptada
      try {
        const keyStr = key.toString('utf8');
        if (keyStr.includes('ENCRYPTED')) {
          console.warn('🔐 A chave privada parece estar ENCRYPTED. Verifique a passphrase (CORA_PRIVATE_KEY_PASSPHRASE).');
        }
      } catch (e) { /* ignore */ }

      this.httpsAgent = new https.Agent({
        cert,
        key,
        passphrase: this.privateKeyPassphrase,
        rejectUnauthorized: true
      });
      console.log('✅ HTTPS Agent criado com sucesso.');
      return this.httpsAgent;
    } catch (error) {
      console.error('❌ Erro ao criar HTTPS Agent:', error.message);
      throw error;
    }
  }

  async getAccessToken() {
    if (this.token && this.tokenExpiry && new Date() < this.tokenExpiry) {
      console.log('✅ Usando token de acesso em cache.');
      return this.token;
    }

    console.log('🔄 Obtendo novo token de acesso...');
    const httpsAgent = await this.createHttpsAgent();
    const tokenUrl = `${this.apiBaseUrl.replace(/\/$/, '')}/token`;
    const requestBody = querystring.stringify({
      grant_type: 'client_credentials',
      client_id: this.clientId
    });

    try {
    
      const response = await axios.post(tokenUrl, requestBody, {
        httpsAgent,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      this.token = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + 50 * 60 * 1000);
      console.log('✅ Token de acesso obtido e armazenado.');
      return this.token;
    } catch (error) {
      console.error('❌ Erro ao obter token de acesso:', error.message);
      if (error.response) {
        console.error('📄 Status da resposta:', error.response.status);
        console.error('📄 Dados da resposta:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Consulta detalhes brutos do invoice (boleto).
   */
  async consultarDetalhesBoleto(invoiceId) {
    try {
      const httpsAgent = await this.createHttpsAgent();
      const token = await this.getAccessToken();
      const url = `${this.apiBaseUrl.replace(/\/$/, '')}/v2/invoices/${invoiceId}`;
      console.log(`📡 Enviando GET para detalhes do boleto: ${url}`);
      const response = await axios.get(url, {
        httpsAgent,
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`📥 Resposta de detalhes para ${invoiceId} - status ${response.status}`);
      // log completo para debug (comentável se poluir)
      try {
        console.log(`📄 Dados brutos do detalhe (${invoiceId}):`, JSON.stringify(response.data, null, 2));
      } catch (e) {
        console.log('📄 (Erro ao serializar dados de detalhe para log)');
      }
      return response.data;
    } catch (error) {
      console.error(`❌ Erro ao consultar detalhes do boleto ${invoiceId}:`, error.message);
      if (error.response) {
        console.error('📄 Status da resposta:', error.response.status);
        console.error('📄 Dados da resposta:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Extrai a "chave pix" ou payload (EMV/BRCode) a partir dos detalhes do invoice.
   * Retorna { pix_key, pix_payload }.
   */
  _extractPixFromInvoiceDetails(details) {
    if (!details) return { pix_key: null, pix_payload: null };
    const tryPaths = [
      () => details?.pix?.key,
      () => details?.pix?.chave,
      () => details?.pix_key,
      () => details?.pix?.emv,
      () => details?.payment?.pix?.key,
      () => details?.payment?.pix?.chave,
      () => details?.payments?.[0]?.pix?.key,
      () => details?.payments?.[0]?.pix?.chave,
      () => details?.payment_data?.pix_key,
      () => details?.payment?.qrcode?.pix_key,
      () => details?.payment?.qrcode?.pix?.key,
      () => details?.payment?.qrcode?.payload,
      () => details?.payment_options?.pix?.emv,
      () => details?.payment_options?.pix?.payload
    ];

    for (const fn of tryPaths) {
      try {
        const val = fn();
        if (val && typeof val === 'string' && val.trim() !== '') {
          if (val.length > 100 || /br\.gov\.bcb\.pix|000201/.test(val)) {
            return { pix_key: null, pix_payload: val };
          }
          return { pix_key: val, pix_payload: null };
        }
      } catch (e) {
        // ignore
      }
    }

    // fallback: olhar em details.pix.emv ou details.pix if exists
    const emv = details?.pix?.emv || details?.payment?.qrcode?.brcode || details?.payment?.qrcode?.text;
    if (emv && typeof emv === 'string') {
      const m = emv.match(/cobv\/([0-9a-fA-F\-]{8,})/) || emv.match(/cob\/v?\/([0-9a-fA-F\-]{8,})/);
      if (m) {
        return { pix_key: m[1], pix_payload: emv };
      }
      return { pix_key: null, pix_payload: emv };
    }

    return { pix_key: null, pix_payload: null };
  }

  /**
   * Formata um invoice (detalhe) para os campos solicitados pelo front.
   * Adicionado customer_document para facilitar a filtragem por CPF.
   */
  _formatInvoiceForFront(details) {
    if (!details) return null;

    const studentName = details?.customer?.name || details?.customer_name || (details.services && details.services[0] && details.services[0].name) || null;
    const status = details?.status || null;
    const dueDate = details?.payment_terms?.due_date || details?.due_date || null;
    let amountCents = null;
    if (typeof details?.total_amount === 'number') amountCents = details.total_amount;
    else if (Array.isArray(details?.services) && details.services.length && typeof details.services[0].amount === 'number') amountCents = details.services[0].amount;
    else if (typeof details?.amount === 'number') amountCents = details.amount;
    const amountFormatted = (amountCents != null) ? (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
    const { pix_key, pix_payload } = this._extractPixFromInvoiceDetails(details);
    const barcode = details?.payment_options?.bank_slip?.barcode || details?.payment_options?.bank_slip?.bar_code || null;
    const digitable = details?.payment_options?.bank_slip?.digitable || details?.payment_options?.bank_slip?.line || details?.payment_options?.bank_slip?.our_number || null;
    const pdfUrl = details?.payment_options?.bank_slip?.url || details?.payment_options?.bank_slip?.pdf_url || null;
    const customerDocument = details?.customer?.document?.identity || null; // Adicionado para filtragem por CPF

    return {
      id: details.id || null,
      student_name: studentName,
      status,
      due_date: dueDate,
      amount_cents: amountCents,
      amount: amountFormatted,
      pix_key,
      pix_payload,
      barcode,
      digitable,
      pdf_url: pdfUrl,
      customer_document: customerDocument // Incluído no objeto formatado
    };
  }

  /**
   * Consulta um boleto por id e retorna o objeto formatado para o front.
   */
  async consultarBoletoFormatado(invoiceId) {
    try {
      console.log(`🔎 Consultando e formatando boleto id=${invoiceId}...`);
      const details = await this.consultarDetalhesBoleto(invoiceId);
      const formatted = this._formatInvoiceForFront(details);
      console.log(`✅ Boleto formatado pronto para envio ao front (id=${invoiceId}).`);
      console.log(JSON.stringify(formatted, null, 2));
      return formatted;
    } catch (error) {
      console.error(`❌ Erro ao consultarBoletoFormatado ${invoiceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Busca boletos (paginação) e retorna array de boletos formatados para o front.
   * Agora aceita um customerDocument para filtrar na API.
   */
  async buscarTodosBoletos(customerDocument = null) { // Adicionado parâmetro customerDocument
    console.log(`🔍 Iniciando busca de boletos (formatados) na Cora para CPF: ${customerDocument || 'TODOS'}...`);
    let page = 1;
    const perPage = 200;
    const formattedBoletos = [];
    const startDateStr = '2020-01-01';
    const endDateStr = '2030-12-31';

    try {
      const httpsAgent = await this.createHttpsAgent();
      const token = await this.getAccessToken();
      let totalItemsProcessed = 0;
      let totalItems = 0;

      do {
        console.log(`📄 Buscando página ${page} da API Cora...`);
        const params = {
          page,
          perPage,
          start: startDateStr,
          end: endDateStr
        };

        // Adiciona o filtro de CPF se fornecido
        if (customerDocument) {
          params.customer_document = customerDocument; // ASSUMIMOS QUE A API CORA ACEITA ESTE PARÂMETRO
          console.log(`   -> Filtrando por customer_document: ${customerDocument}`);
        }

        const response = await axios.get(`${this.apiBaseUrl.replace(/\/$/, '')}/v2/invoices`, {
          httpsAgent,
          headers: { Authorization: `Bearer ${token}` },
          params: params // Passa os parâmetros, incluindo o CPF se existir
        });
        console.log(`📊 Resposta da API - Status: ${response.status}`);
        const items = response.data.items || [];
        totalItems = response.data.totalItems || (totalItems || items.length);
        console.log(`📊 Items na resposta: ${items.length}`);

        if (!items || items.length === 0) {
          console.log('📄 Nenhum item encontrado nesta página. Encerrando paginação.');
          break;
        }

        // Buscar detalhes em paralelo para os items desta página
        const detailPromises = items.map(it =>
          this.consultarDetalhesBoleto(it.id)
            .then(details => ({ id: it.id, details }))
            .catch(err => ({ id: it.id, details: null, error: err.message || String(err) }))
        );

        const settled = await Promise.all(detailPromises);
        let addedThisPage = 0;
        for (const res of settled) {
          if (res && res.details) {
            const details = res.details;
            const status = String(details.status || '').toUpperCase();
            if (status.startsWith('CANCEL')) {
              console.log(`❌ Ignorando boleto cancelado: ${res.id}`);
              continue;
            }
            const formatted = this._formatInvoiceForFront(details);
            formattedBoletos.push(formatted);
            addedThisPage++;
          } else {
            console.warn(`⚠️ Não foi possível obter detalhes para ${res.id}: ${res.error || 'erro desconhecido'}`);
          }
        }
        console.log(`✅ Página ${page} processada. Adicionados: ${addedThisPage}`);
        totalItemsProcessed += items.length;
        page++;
        await new Promise(resolve => setTimeout(resolve, 120));
      } while (totalItemsProcessed < totalItems);

      console.log(`✅ Busca concluída. Total boletos formatados: ${formattedBoletos.length}`);
      return formattedBoletos;
    } catch (error) {
      console.error('❌ Erro ao buscar todos os boletos:', error.message);
      if (error.response) {
        console.error('📄 Status da resposta:', error.response.status);
        console.error('📄 Dados da resposta:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Busca boletos para um CPF específico, separando-os em atrasados e o próximo a vencer.
   * Retorna { boletosAtrasados, proximoBoletoAVencer }.
   */
async consultarBoletosPorCpf(cpf) {
  console.log(`🔍 Iniciando busca de boletos na Cora para o CPF: ${cpf}...`);
  let page = 1;
  const perPage = 200;
  let allBoletos = [];
  const startDateStr = '2020-01-01';
  const endDateStr = '2030-12-31';

  try {
    const httpsAgent = await this.createHttpsAgent();
    const token = await this.getAccessToken();
    let totalItemsProcessed = 0;
    let totalItems = 0;

    // paginação para coletar items (list)
    do {
      console.log(`📄 Buscando página ${page} da API Cora para CPF ${cpf}...`);
      const response = await axios.get(`${this.apiBaseUrl.replace(/\/$/, '')}/v2/invoices`, {
        httpsAgent,
        headers: { 'Authorization': `Bearer ${token}` },
        params: {
          page,
          perPage,
          start: startDateStr,
          end: endDateStr,
          search: cpf
        },
        timeout: 20000
      });

      console.log(`📊 Resposta da API - Status: ${response.status}`);
      const items = response.data.items || [];
      totalItems = response.data.totalItems || (items ? items.length : totalItems);
      console.log(`📊 Items na resposta: ${items.length}`);
      if (!items || items.length === 0) {
        console.log('📄 Nenhum item encontrado nesta página ou todas as páginas foram processadas.');
        break;
      }

      allBoletos = allBoletos.concat(items);
      totalItemsProcessed += items.length;
      page++;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (totalItemsProcessed < totalItems);

    console.log(`✅ Busca inicial concluída: ${allBoletos.length} boletos encontrados para o CPF ${cpf}.`);

    // --- NOVA ETAPA: buscar detalhes para cada invoice e formatar ---
    const BATCH_SIZE = 20; // ajuste conforme necessidade / rate limits
    const formattedAll = [];

    for (let i = 0; i < allBoletos.length; i += BATCH_SIZE) {
      const batch = allBoletos.slice(i, i + BATCH_SIZE);
      console.log(`📦 Processando lote ${Math.floor(i / BATCH_SIZE) + 1} (ids ${batch.map(b => b.id).join(', ')})`);

      const promises = batch.map(it =>
        this.consultarDetalhesBoleto(it.id)
          .then(details => ({ id: it.id, details }))
          .catch(err => ({ id: it.id, details: null, error: err }))
      );

      const results = await Promise.all(promises);

      for (const r of results) {
        if (r && r.details) {
          const formatted = this._formatInvoiceForFront(r.details);
          if (formatted) formattedAll.push(formatted);
        } else {
          console.warn(`⚠️ Não foi possível obter detalhes para ${r.id}: ${r.error || 'erro desconhecido'}`);
        }
      }

      // pequeno delay entre lotes para reduzir pressão na API
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    console.log(`✅ Todos os detalhes obtidos e formatados: ${formattedAll.length} boletos formatados.`);

    // agora aplicar lógica de separação e ordenação sobre os objetos formatados
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const boletosAtivos = formattedAll.filter(boleto =>
      (String(boleto.status).toUpperCase() === 'OPEN' || String(boleto.status).toUpperCase() === 'LATE') &&
      String(boleto.status).toUpperCase() !== 'CANCELLED'
    );

    let boletosAtrasados = [];
    let boletosFuturosOuHoje = [];

    for (const boleto of boletosAtivos) {
      const dataVencimento = new Date(boleto.due_date);
      dataVencimento.setHours(0, 0, 0, 0);
      if (dataVencimento < hoje) boletosAtrasados.push(boleto);
      else boletosFuturosOuHoje.push(boleto);
    }

    boletosAtrasados.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    boletosFuturosOuHoje.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    let proximoBoletoAVencer = null;
    if (boletosFuturosOuHoje.length > 0) proximoBoletoAVencer = boletosFuturosOuHoje[0];
    else if (boletosAtrasados.length > 0) proximoBoletoAVencer = boletosAtrasados[0];

    console.log(`📊 ${boletosAtrasados.length} boletos atrasados encontrados.`);
    if (proximoBoletoAVencer) {
      console.log(`➡️ Próximo boleto a vencer (ou mais antigo atrasado): ID ${proximoBoletoAVencer.id}, Vencimento: ${proximoBoletoAVencer.due_date}, Status: ${proximoBoletoAVencer.status}`);
    } else {
      console.log('➡️ Nenhum próximo boleto a vencer encontrado.');
    }

    // Retorna objetos formatados — cada objeto já contém pix_key e pdf_url (quando presentes)
    return {
      boletosAtrasados,
      proximoBoletoAVencer
    };

  } catch (error) {
    console.error(`❌ Erro ao consultar boletos para o CPF ${cpf}:`, error.message);
    if (error.response) {
      console.error('📄 Status da resposta:', error.response.status);
      console.error('📄 Dados da resposta:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}
async gerarPixMatricula({ nome, cpf, email, whatsapp, plano, nomePlano, valorMatricula }) {
  const { randomUUID } = require('crypto');

  const httpsAgent = await this.createHttpsAgent();
  const token = await this.getAccessToken();

  const hoje = new Date();
  hoje.setDate(hoje.getDate() + 2);
  const dueDate = hoje.toISOString().split('T')[0];

  const payload = {
    code: `matricula_${plano}_${Date.now()}`,
    customer: {
      name: nome,
      email: email,
      document: {
        identity: cpf,
        type: 'CPF'
      }
    },
    services: [
      {
        name: nomePlano,
        description: `Matrícula - ${nomePlano}`,
        amount: valorMatricula
      }
    ],
    payment_terms: {
      due_date: dueDate
    },
    payment_forms: ['PIX']
  };

  const response = await axios.post(
    `${this.apiBaseUrl.replace(/\/$/, '')}/v2/invoices/`,
    payload,
    {
      httpsAgent,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': randomUUID()
      }
    }
  );

  return response.data;
}
}

module.exports = new CoraService();
