# Documentação do Fluxo de Checkout Pix para Matrícula — Clube de Pregadores

## 1. Objetivo do projeto

O objetivo deste projeto é permitir que um visitante da landing page escolha um plano, preencha seus dados e gere automaticamente um Pix de matrícula no valor de R$ 99,90 através da API da Cora.

O sistema não cria carnê parcelado neste primeiro momento. A ideia é simplificar o fluxo:

1. O aluno escolhe um plano.
2. Vai para uma página de checkout.
3. Preenche nome, CPF, e-mail e WhatsApp.
4. O sistema gera uma cobrança Pix pela API da Cora.
5. O aluno paga a matrícula.
6. A secretaria confere o pagamento e depois cria os boletos/carnê manualmente.

---

## 2. Arquitetura geral

O projeto terá duas partes principais:

```txt
WordPress
├── Landing page dos planos
└── Página de checkout da matrícula

Node.js / Express
├── API de consulta de boletos já existente
└── Nova rota para gerar Pix de matrícula pela Cora
```

O WordPress será responsável apenas pela interface visual.

A API Node.js será responsável por se comunicar com a Cora.

Importante: os certificados, chaves privadas e credenciais da Cora devem ficar somente no backend Node.js. Nunca devem ficar no WordPress ou no JavaScript público.

---

## 3. Fluxo do usuário

### 3.1 Página de planos

Na landing page existem os cards dos planos, por exemplo:

```txt
Bacharel em Teologia — Graduação
Bacharel Livre em Teologia
Plano Premium Anual
```

Cada botão deve enviar o usuário para uma página de checkout com o plano escolhido na URL.

Exemplo:

```txt
/checkout/?plano=bacharel-mec
/checkout/?plano=bacharel-livre
/checkout/?plano=premium-anual
```

---

### 3.2 Página de checkout

A página de checkout deve exibir:

```txt
Você escolheu:
Bacharel Livre em Teologia

Matrícula:
R$ 99,90

Campos:
- Nome completo
- CPF
- E-mail
- WhatsApp

Botão:
Gerar Pix da Matrícula
```

Após o envio, a página deve chamar a API Node.js.

Endpoint:

```txt
POST /api/matricula/gerar-pix
```

Body JSON:

```json
{
  "nome": "Nome do Aluno",
  "cpf": "12345678909",
  "email": "aluno@email.com",
  "whatsapp": "11999999999",
  "plano": "bacharel-livre"
}
```

---

### 3.3 Tela de pagamento

Se a API responder com sucesso, o front-end deve exibir:

```txt
Matrícula gerada com sucesso!

Valor: R$ 99,90

Escaneie o QR Code abaixo:
[imagem do QR Code]

Ou copie o Pix Copia e Cola:
[código Pix]

[Botão Copiar Código Pix]
```

Resposta esperada da API:

```json
{
  "sucesso": true,
  "id": "inv_xxxxxxxxxxxxx",
  "status": "OPEN",
  "valor": 9990,
  "qr_code_url": "https://...",
  "pix_copia_e_cola": "000201..."
}
```

---

## 4. Backend Node.js

O projeto Node.js já possui estrutura parecida com esta:

```txt
src/
├── servidor.js
├── rotas/
│   ├── rotasBoletos.js
│   └── rotasMatricula.js
├── controladores/
│   ├── controladorBoletos.js
│   └── controladorMatricula.js
├── servicos/
│   └── servicoCora.js
└── utilitarios/
    └── validadorCpf.js
```

---

## 5. Arquivo `servidor.js`

O arquivo `servidor.js` precisa carregar a nova rota de matrícula.

Exemplo:

```js
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');

const rotasBoletos = require('./rotas/rotasBoletos');
const rotasMatricula = require('./rotas/rotasMatricula');

const app = express();
const PORTA = process.env.PORT;

app.use(express.json());

const corsOptions = {
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

app.get('/', (req, res) => {
  res.status(200).json({
    mensagem: 'API OK',
    build: 'GET-CPF-ATIVO'
  });
});

app.use('/api/boletos', rotasBoletos);
app.use('/api/matricula', rotasMatricula);

app.use((req, res) => {
  console.warn(`Rota não encontrada: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  console.error('Erro inesperado no servidor:', err.stack);
  res.status(500).json({
    erro: 'Ocorreu um erro interno no servidor.'
  });
});

app.listen(PORTA, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORTA}`);
});
```

Ponto importante:

```js
app.use(express.json());
```

Essa linha é obrigatória para que o Express consiga ler o JSON enviado pelo front-end ou pelo Insomnia.

---

## 6. Nova rota: `rotasMatricula.js`

Criar o arquivo:

```txt
src/rotas/rotasMatricula.js
```

Código:

```js
const express = require('express');
const router = express.Router();

const controladorMatricula = require('../controladores/controladorMatricula');

router.post('/gerar-pix', controladorMatricula.gerarPixMatricula);

module.exports = router;
```

Essa rota cria o endpoint:

```txt
POST /api/matricula/gerar-pix
```

---

## 7. Novo controlador: `controladorMatricula.js`

Criar o arquivo:

```txt
src/controladores/controladorMatricula.js
```

Código:

```js
const servicoCora = require('../servicos/servicoCora');
const validadorCpf = require('../utilitarios/validadorCpf');

const gerarPixMatricula = async (req, res) => {
  const { nome, cpf, email, whatsapp, plano } = req.body;

  if (!nome || !cpf || !email) {
    return res.status(400).json({
      erro: 'Nome, CPF e e-mail são obrigatórios.'
    });
  }

  if (!validadorCpf.validar(cpf)) {
    return res.status(400).json({
      erro: 'CPF inválido.'
    });
  }

  const cpfLimpo = validadorCpf.limpar(cpf);

  try {
    const cobranca = await servicoCora.gerarPixMatricula({
      nome,
      cpf: cpfLimpo,
      email,
      whatsapp,
      plano
    });

    return res.status(200).json({
      sucesso: true,
      id: cobranca.id,
      status: cobranca.status,
      valor: cobranca.total_amount,
      qr_code_url: cobranca.payment_options?.bank_slip?.url,
      pix_copia_e_cola: cobranca.pix?.emv
    });

  } catch (error) {
    console.error('Erro ao gerar Pix de matrícula:', error.message);

    if (error.response) {
      console.error('Status da Cora:', error.response.status);
      console.error('Resposta da Cora:', JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({
      erro: 'Não foi possível gerar o Pix da matrícula.'
    });
  }
};

module.exports = {
  gerarPixMatricula
};
```

---

## 8. Serviço da Cora: `servicoCora.js`

No arquivo já existente:

```txt
src/servicos/servicoCora.js
```

Adicionar o método abaixo dentro da classe `CoraService`, antes do fechamento final da classe:

```js
async gerarPixMatricula({ nome, cpf, email, whatsapp, plano }) {
  const { v4: uuidv4 } = require('uuid');

  const httpsAgent = await this.createHttpsAgent();
  const token = await this.getAccessToken();

  const hoje = new Date();
  hoje.setDate(hoje.getDate() + 2);

  const dueDate = hoje.toISOString().split('T')[0];

  const payload = {
    code: `matricula_${plano || 'curso'}_${Date.now()}`,
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
        name: 'Matrícula',
        description: 'Matrícula em curso teológico',
        amount: 9990
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
        'Idempotency-Key': uuidv4()
      }
    }
  );

  return response.data;
}
```

---

## 9. Dependência necessária

Instalar o pacote `uuid`:

```bash
npm install uuid
```

Ele é usado para gerar o header:

```txt
Idempotency-Key
```

Esse header evita duplicidade de cobrança caso a mesma requisição seja reenviada por erro de conexão.

---

## 10. Variáveis de ambiente

O projeto depende de variáveis no `.env`.

Exemplo:

```env
PORT=3001
FRONTEND_URL=https://seudominio.com.br

CORA_API_BASE_URL=https://api.cora.com.br
CORA_CLIENT_ID=seu_client_id

CORA_CERT_FOLDER_PATH=E:/node/certificados-cora
CORA_CERT_FILENAME=certificate.pem
CORA_KEY_FILENAME=private_key.pem
CORA_PRIVATE_KEY_PASSPHRASE=NONE
```

Observação:

Nunca subir o `.env`, certificado ou chave privada para repositório público.

---

## 11. Teste local com Insomnia

### Método

```txt
POST
```

### URL

```txt
http://localhost:3001/api/matricula/gerar-pix
```

### Headers

```txt
Content-Type: application/json
```

### Body JSON

```json
{
  "nome": "Aluno Teste",
  "cpf": "52998224725",
  "email": "teste@teste.com",
  "whatsapp": "11999999999",
  "plano": "bacharel-livre"
}
```

### Resposta esperada

```json
{
  "sucesso": true,
  "id": "inv_xxxxxxxxxxxxx",
  "status": "OPEN",
  "valor": 9990,
  "qr_code_url": "https://storage.googleapis.com/...",
  "pix_copia_e_cola": "000201..."
}
```

---

## 12. Front-end WordPress

A página de checkout será criada no WordPress usando um plugin PHP com shortcode.

O shortcode sugerido:

```txt
[checkout_matricula]
```

A página do WordPress pode ser:

```txt
https://seudominio.com.br/checkout/
```

E os botões da landing page devem apontar para:

```txt
https://seudominio.com.br/checkout/?plano=bacharel-mec
https://seudominio.com.br/checkout/?plano=bacharel-livre
https://seudominio.com.br/checkout/?plano=premium-anual
```

---

## 13. O que o plugin WordPress deve fazer

O plugin deve:

1. Ler o parâmetro `plano` da URL.
2. Mostrar o nome do plano escolhido.
3. Mostrar o valor da matrícula.
4. Exibir formulário de cadastro.
5. Enviar os dados para a API Node.js.
6. Receber o QR Code e Pix Copia e Cola.
7. Exibir a tela de pagamento.

---

## 14. Exemplo de chamada JavaScript no WordPress

```js
fetch('https://sua-api.com/api/matricula/gerar-pix', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    nome: nome,
    cpf: cpf,
    email: email,
    whatsapp: whatsapp,
    plano: plano
  })
})
.then(response => response.json())
.then(data => {
  if (data.sucesso) {
    document.querySelector('#qr-code').src = data.qr_code_url;
    document.querySelector('#pix-copia-e-cola').value = data.pix_copia_e_cola;
  } else {
    alert(data.erro || 'Erro ao gerar Pix.');
  }
});
```

---

## 15. CORS

A API Node.js usa CORS com a variável:

```env
FRONTEND_URL=https://seudominio.com.br
```

Durante testes locais, pode usar:

```env
FRONTEND_URL=http://localhost
```

Ou liberar temporariamente para testes, mas em produção o ideal é restringir para o domínio real.

---

## 16. Salvamento dos dados

Neste primeiro momento, o sistema ainda não salva os dados em banco.

Mas é recomendado salvar:

```txt
nome
cpf
email
whatsapp
plano
id_cora
status
valor
qr_code_url
pix_copia_e_cola
data_criacao
```

Pode ser salvo em:

```txt
Banco MySQL
Banco PostgreSQL
Arquivo JSON simples
Google Sheets
Tabela própria no WordPress
```

Para início, a melhor opção pode ser uma tabela no próprio WordPress ou banco simples externo.

---

## 17. Confirmação de pagamento

Neste MVP, a confirmação pode ser manual.

Fluxo:

```txt
Aluno paga Pix
↓
Secretaria confere na Cora
↓
Secretaria libera acesso
↓
Secretaria gera carnê manualmente
```

Depois, pode ser criado um webhook da Cora para automatizar:

```txt
Pix pago
↓
Webhook chama sua API
↓
Sistema atualiza status para PAID
↓
Sistema libera acesso automaticamente
```

---

## 18. O que não fazer

Não colocar certificado da Cora no WordPress.

Não gerar Pix manualmente.

Não expor `CORA_CLIENT_ID`, certificado ou private key no navegador.

Não confiar apenas no front-end para valor do plano.

Não receber valor enviado pelo usuário como valor final da cobrança.

O valor da matrícula deve ser definido no backend:

```js
amount: 9990
```

Assim ninguém consegue alterar o valor pelo navegador.

---

## 19. Melhor fluxo para este momento

O fluxo recomendado é:

```txt
Landing Page
↓
Usuário escolhe plano
↓
Checkout WordPress
↓
API Node gera Pix na Cora
↓
Usuário paga matrícula
↓
Secretaria confirma manualmente
↓
Secretaria libera acesso e cria carnê
```

Esse fluxo é mais simples, seguro e suficiente para baixo volume de vendas.

---

## 20. Status atual do projeto

Já foi testado com sucesso o endpoint:

```txt
POST /api/matricula/gerar-pix
```

A API retornou:

```json
{
  "sucesso": true,
  "status": "OPEN",
  "valor": 9990,
  "qr_code_url": "https://...",
  "pix_copia_e_cola": "000201..."
}
```

Isso confirma que:

```txt
A autenticação com a Cora está funcionando.
O certificado está funcionando.
A criação de cobrança Pix está funcionando.
A cobrança foi criada em produção.
O QR Code oficial da Cora foi retornado.
O Pix Copia e Cola oficial foi retornado.
```

---

## 21. Próxima etapa

Criar o plugin WordPress com shortcode:

```txt
[checkout_matricula]
```

Esse plugin será responsável pela página visual do checkout.

A API Node.js já está pronta para gerar a cobrança Pix.
