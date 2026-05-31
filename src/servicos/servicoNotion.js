const { Client } = require('@notionhq/client');

// As chaves precisam estar na Vercel
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function salvarMatriculaNoNotion(dados) {
  // Nota: Os nomes das propriedades abaixo (Name, CPF, Email, etc.)
  // DEVEM ser exatamente iguais aos nomes das colunas lá na sua tabela do Notion.
  await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      'Nome': { title: [{ text: { content: dados.nome } }] },
      'CPF': { rich_text: [{ text: { content: dados.cpf } }] },
      'Email': { email: dados.email },
      'WhatsApp': { rich_text: [{ text: { content: dados.whatsapp } }] },
      'Plano': { select: { name: dados.plano } },
      'Valor': { number: dados.valor / 100 },
      'ID Cora': { rich_text: [{ text: { content: dados.id } }] },
      'Status': { select: { name: dados.status } },
      'Data': { date: { start: new Date().toISOString() } },
      // Omiti QR Code e Copia e Cola por serem strings gigantes, 
      // mas se quiser salvar, basta adicionar como rich_text.
    },
  });
}

module.exports = { salvarMatriculaNoNotion };