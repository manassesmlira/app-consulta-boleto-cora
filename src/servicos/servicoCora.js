const axios = require('axios');
const https = require('https');
const fs = require('fs').promises; // Usando a versão com Promises do módulo fs
const path = require('path');
const querystring = require('querystring');
// Carrega as variáveis de ambiente do arquivo .env se não estiver em produção
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
class CoraService {
    constructor() {
        this.httpsAgent = null;
        this.token = null;
        this.tokenExpiry = null;
        // Atribui as variáveis de ambiente a propriedades da classe para fácil acesso
        this.apiBaseUrl = process.env.CORA_API_BASE_URL;
        this.clientId = process.env.CORA_CLIENT_ID;
        this.privateKeyPassphrase = process.env.CORA_PRIVATE_KEY_PASSPHRASE;
        // Conteúdo direto das variáveis de ambiente (usado como fallback)
        this.certEnvVar = process.env.CORACERT;
        this.keyEnvVar = process.env.CORAKEY;
        // Caminhos para arquivos (prioridade)
        this.certFolderPath = process.env.CORA_CERT_FOLDER_PATH; // Ex: "C:/node/cert_key_cora_production_2025_04_29"
        this.certificateFilename = process.env.CORA_CERT_FILENAME || 'certificate.pem';
        this.privateKeyFilename = process.env.CORA_KEY_FILENAME || 'private_key.pem';
        // Validação básica das variáveis de ambiente essenciais
        if (!this.apiBaseUrl || !this.clientId) {
            console.error('❌ Variáveis de ambiente CORA_API_BASE_URL ou CORA_CLIENT_ID não definidas.');
            throw new Error('Configurações essenciais da Cora API estão faltando.');
        }
        // Validação para cert/key: Pelo menos uma forma de carregar deve existir
        // Ou o caminho da pasta deve ser definido, ou as variáveis de ambiente diretas.
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
     * Carrega o conteúdo do certificado ou da chave privada.
     * Prioriza a leitura de arquivos do sistema de arquivos se CORA_CERT_FOLDER_PATH estiver definido.
     * Caso contrário, ou se a leitura do arquivo falhar, tenta usar o conteúdo das variáveis de ambiente.
     * @param {'cert'|'key'} type - O tipo de conteúdo a ser carregado ('cert' para certificado, 'key' para chave privada).
     * @returns {Promise<Buffer>} O conteúdo do certificado ou da chave como um Buffer.
     * @throws {Error} Se o conteúdo não puder ser carregado de nenhuma fonte.
     */
    async _loadCertOrKeyContent(type) {
        let content = null;
        let source = 'desconhecida';
        const envVarContent = (type === 'cert') ? this.certEnvVar : this.keyEnvVar;
        const filename = (type === 'cert') ? this.certificateFilename : this.privateKeyFilename;
        const typeName = (type === 'cert') ? 'certificado' : 'chave privada';
        // 1. Tenta ler do arquivo se o caminho da pasta estiver definido
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
        // 2. Se não conseguiu ler do arquivo, tenta usar a variável de ambiente
        if (!content && envVarContent) {
            console.log(`🔑 Usando conteúdo do ambiente para ${typeName}.`);
            content = Buffer.from(envVarContent, 'utf-8');
            source = `variável de ambiente (CORA${type.toUpperCase()})`;
        }
        if (!content) {
            throw new Error(`Não foi possível carregar o ${typeName}. Nenhuma fonte válida encontrada (arquivo ou variável de ambiente).`);
        }
        console.log(`✅ ${typeName} carregado com sucesso de: ${source}`);
        return content;
    }
    /**
     * Cria e retorna um agente HTTPS com certificados de cliente.
     * Armazena o agente em cache para reutilização.
     * @returns {Promise<https.Agent>} O agente HTTPS configurado.
     * @throws {Error} Se os certificados ou chaves não puderem ser carregados.
     */
    async createHttpsAgent() {
        if (this.httpsAgent) {
            return this.httpsAgent;
        }
        try {
            const cert = await this._loadCertOrKeyContent('cert');
            const key = await this._loadCertOrKeyContent('key');
            this.httpsAgent = new https.Agent({
                cert: cert,
                key: key,
                passphrase: this.privateKeyPassphrase,
                rejectUnauthorized: true // Garante que o certificado do servidor seja validado
            });
            console.log('✅ HTTPS Agent criado com sucesso.');
            return this.httpsAgent;
        } catch (error) {
            console.error('❌ Erro ao criar HTTPS Agent:', error.message);
            throw error;
        }
    }
    /**
     * Obtém um token de acesso da API Cora. Armazena o token em cache e o atualiza se estiver expirado.
     * @returns {Promise<string>} O token de acesso.
     * @throws {Error} Se não for possível obter o token de acesso.
     */
    async getAccessToken() {
        // Verifica se o token ainda é válido
        if (this.token && this.tokenExpiry && new Date() < this.tokenExpiry) {
            console.log('✅ Usando token de acesso em cache.');
            return this.token;
        }
        console.log('🔄 Obtendo novo token de acesso...');
        const httpsAgent = await this.createHttpsAgent();
        const tokenUrl = `${this.apiBaseUrl}/token`;
        const requestBody = querystring.stringify({
            grant_type: 'client_credentials',
            client_id: this.clientId
        });
        try {
            const response = await axios.post(tokenUrl, requestBody, {
                httpsAgent: httpsAgent,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            this.token = response.data.access_token;
            // Define a expiração para 50 minutos (tokens geralmente duram 1 hora)
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
     * Busca faturas (boletos) na API Cora para um CPF específico,
     * identificando boletos atrasados e o próximo a vencer com base na data atual.
     * @param {string} cpf - O CPF do pagador para filtrar os boletos.
     * @returns {Promise<{boletosAtrasados: Array<object>, proximoBoletoAVencer: object|null}>} Um objeto contendo a lista de boletos atrasados e o próximo a vencer.
     * @throws {Error} Se houver um erro ao buscar os boletos.
     */
    async consultarBoletosPorCpf(cpf) {
        console.log(`🔍 Iniciando busca de boletos na Cora para o CPF: ${cpf}...`);
        let page = 1;
        const perPage = 200;
        let allBoletos = [];
        // Definir um período de busca amplo para garantir que todos os boletos relevantes sejam capturados
        // A filtragem por "atrasado" e "próximo a vencer" será feita localmente.
        const startDateStr = '2020-01-01'; // Data de início suficientemente no passado
        const endDateStr = '2030-12-31';   // Data de término suficientemente no futuro
        try {
            const httpsAgent = await this.createHttpsAgent();
            const token = await this.getAccessToken();
            let totalItemsProcessed = 0;
            let totalItems = 0;
            do {
                console.log(`📄 Buscando página ${page} da API Cora para CPF ${cpf}...`);
                const response = await axios.get(`${this.apiBaseUrl}/v2/invoices`, {
                    httpsAgent: httpsAgent,
                    headers: { 'Authorization': `Bearer ${token}` },
                    params: {
                        page: page,
                        perPage: perPage,
                        start: startDateStr,
                        end: endDateStr,
                        search: cpf
                    }
                });
                console.log(`📊 Resposta da API - Status: ${response.status}`);
                // console.log('📄 Dados brutos da resposta da API Cora:', JSON.stringify(response.data, null, 2)); // Descomente se precisar ver o JSON completo novamente
                console.log(`📊 Resposta da API - Status: ${response.status}`);
                const items = response.data.items;
                totalItems = response.data.totalItems || (items ? items.length : 0);
                console.log(`📊 Items na resposta: ${items?.length || 0}`);
                console.log(`📊 Total items esperados: ${totalItems}`);
                if (!items || items.length === 0) {
                    console.log('📄 Nenhum item encontrado nesta página ou todas as páginas foram processadas.');
                    break;
                }
                allBoletos = allBoletos.concat(items);
                totalItemsProcessed += items.length;
                page++;
                // Pequeno delay para não sobrecarregar a API
                await new Promise(resolve => setTimeout(resolve, 100));
            } while (totalItemsProcessed < totalItems);
            console.log(`✅ Busca inicial concluída: ${allBoletos.length} boletos encontrados para o CPF ${cpf}.`);

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0); // Zera a hora para comparação de data
            console.log('DEBUG: Data de hoje (normalizada para UTC meia-noite):', hoje.toISOString());

            const boletosAtivos = allBoletos.filter(boleto =>
                (boleto.status === 'OPEN' || boleto.status === 'LATE') && boleto.status !== 'CANCELLED'
            );

            console.log(`DEBUG: boletosAtivos.length: ${boletosAtivos.length}`);
            console.log('DEBUG: Conteúdo de boletosAtivos (ID, Status, Due_Date):', boletosAtivos.map(b => ({ id: b.id, status: b.status, due_date: b.due_date })));

            let boletosAtrasados = [];
            let boletosFuturosOuHoje = [];

            // Separar boletos em atrasados e futuros/hoje
            for (const boleto of boletosAtivos) {
                const dataVencimento = new Date(boleto.due_date);
                dataVencimento.setHours(0, 0, 0, 0); // Zera a hora para comparação de data

                console.log(`DEBUG: Processando boleto ID: ${boleto.id}, Status: ${boleto.status}`);
                console.log(`DEBUG:   Data Vencimento (original): ${boleto.due_date}`);
                console.log(`DEBUG:   Data Vencimento (normalizada para UTC meia-noite): ${dataVencimento.toISOString()}`);
                console.log(`DEBUG:   Comparando: ${dataVencimento.toISOString()} < ${hoje.toISOString()}?`);

                if (dataVencimento < hoje) {
                    console.log(`DEBUG:   -> Boleto ID ${boleto.id} é ATRASADO.`);
                    boletosAtrasados.push(boleto);
                } else {
                    console.log(`DEBUG:   -> Boleto ID ${boleto.id} é FUTURO/HOJE.`);
                    boletosFuturosOuHoje.push(boleto);
                }
            }

            // Ordenar boletos atrasados (do mais antigo para o mais recente)
            boletosAtrasados.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
            // Ordenar boletos futuros/hoje (do mais próximo para o mais distante)
            boletosFuturosOuHoje.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

            let proximoBoletoAVencer = null;
            // O próximo boleto a vencer é o primeiro da lista de futuros/hoje
            if (boletosFuturosOuHoje.length > 0) {
                proximoBoletoAVencer = boletosFuturosOuHoje[0];
            } else if (boletosAtrasados.length > 0) {
                // Se não houver boletos futuros, o "próximo a vencer" é o mais antigo atrasado
                proximoBoletoAVencer = boletosAtrasados[0];
            }

            console.log(`📊 ${boletosAtrasados.length} boletos atrasados encontrados.`);
            if (proximoBoletoAVencer) {
                console.log(`➡️ Próximo boleto a vencer (ou mais antigo atrasado): ID ${proximoBoletoAVencer.id}, Vencimento: ${proximoBoletoAVencer.due_date}, Status: ${proximoBoletoAVencer.status}`);
            } else {
                console.log('➡️ Nenhum próximo boleto a vencer encontrado.');
            }

            // Adicione um log final para ver o conteúdo das listas
            console.log('DEBUG: boletosAtrasados final:', boletosAtrasados.map(b => ({ id: b.id, due_date: b.due_date, status: b.status })));
            console.log('DEBUG: boletosFuturosOuHoje final:', boletosFuturosOuHoje.map(b => ({ id: b.id, due_date: b.due_date, status: b.status })));


            return {
                boletosAtrasados: boletosAtrasados,
                proximoBoletoAVencer: proximoBoletoAVencer
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
}
module.exports = new CoraService();
