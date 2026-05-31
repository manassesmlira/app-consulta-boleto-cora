const { Resend } = require('resend');
// A chave RESEND_API_KEY deve estar nas variáveis de ambiente da Vercel
const resend = new Resend(process.env.RESEND_API_KEY); 

async function enviarNotificacaoMatricula(dados) {
  const conteudoHTML = `
    <h2>Nova matrícula gerada!</h2>
    <p><strong>Nome:</strong> ${dados.nome}</p>
    <p><strong>CPF:</strong> ${dados.cpf}</p>
    <p><strong>Email:</strong> ${dados.email}</p>
    <p><strong>WhatsApp:</strong> ${dados.whatsapp}</p>
    <p><strong>Plano:</strong> ${dados.plano}</p>
    <p><strong>Valor:</strong> R$ ${(dados.valor / 100).toFixed(2)}</p>
    <p><strong>ID Cora:</strong> ${dados.id}</p>
    <p><strong>Status:</strong> ${dados.status}</p>
  `;

  await resend.emails.send({
    from: 'onboarding@resend.dev', 
    to: 'manassesmlira@gmail.com', 
    subject: `Nova Matrícula (Pix) - ${dados.nome}`,
    html: conteudoHTML,
  });
}

module.exports = { enviarNotificacaoMatricula };