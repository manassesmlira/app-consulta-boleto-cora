const servicoCora = require('../servicos/servicoCora');
const validadorCpf = require('../utilitarios/validadorCpf');

// Importações dos novos serviços
const servicoNotion = require('../servicos/servicoNotion');
const servicoEmail = require('../servicos/servicoEmail');

const gerarPixMatricula = async (req, res) => {
  const { nome, cpf, email, whatsapp, plano } = req.body;

  if (!nome || !cpf || !email || !whatsapp || !plano) {
    return res.status(400).json({
      erro: 'Nome, CPF, e-mail, WhatsApp e plano são obrigatórios.'
    });
  }

  if (!validadorCpf.validar(cpf)) {
    return res.status(400).json({
      erro: 'CPF inválido.'
    });
  }

  const cpfLimpo = validadorCpf.limpar(cpf);

  let valorMatricula = 9990;
  let nomePlano = 'Bacharel Livre em Teologia';

  switch (plano) {
    case 'bacharel-mec':
      valorMatricula = 19700;
      nomePlano = 'Bacharel em Teologia - Graduação';
      break;

    case 'bacharel-livre':
      valorMatricula = 9990;
      nomePlano = 'Bacharel Livre em Teologia';
      break;

    case 'premium-anual':
      valorMatricula = 99700;
      nomePlano = 'Plano Premium Anual';
      break;

    default:
      return res.status(400).json({
        erro: 'Plano inválido.'
      });
  }

  try {
    // 1. Gera o Pix na Cora
    const cobranca = await servicoCora.gerarPixMatricula({
      nome,
      cpf: cpfLimpo,
      email,
      whatsapp,
      plano,
      nomePlano,
      valorMatricula
    });

    const pixCopiaECola =
      cobranca.pix?.emv ||
      cobranca.payment_options?.pix?.emv ||
      cobranca.payment_options?.pix?.payload ||
      null;

    const boletoUrl =
      cobranca.payment_options?.bank_slip?.url ||
      cobranca.payment_options?.bank_slip?.pdf_url ||
      null;

    // Prepara os dados para salvar no Notion e enviar por e-mail
    const dadosMatricula = {
      nome,
      cpf: cpfLimpo,
      email,
      whatsapp,
      plano,
      nomePlano,
      valor: valorMatricula,
      id: cobranca.id,
      status: cobranca.status || 'OPEN',
      pix_copia_e_cola: pixCopiaECola,
      boleto_url: boletoUrl
    };

    // 2. Salva no Notion de forma isolada
    try {
      await servicoNotion.salvarMatriculaNoNotion(dadosMatricula);
      console.log(`✅ Matrícula de ${nome} salva no Notion com sucesso.`);
    } catch (erroNotion) {
      console.error(
        '⚠️ Falha ao salvar no Notion, mas o Pix seguirá normalmente:',
        erroNotion.message
      );
    }

    // 3. Envia o E-mail de forma isolada
    try {
      await servicoEmail.enviarNotificacaoMatricula(dadosMatricula);
      console.log(`✅ E-mail de notificação enviado para a secretaria (${nome}).`);
    } catch (erroEmail) {
      console.error(
        '⚠️ Falha ao enviar e-mail, mas o Pix seguirá normalmente:',
        erroEmail.message
      );
    }

    // 4. Retorna os dados para o Front-end
    return res.status(200).json({
      sucesso: true,
      id: cobranca.id,
      status: cobranca.status || 'OPEN',
      plano,
      nome_plano: nomePlano,
      valor: cobranca.total_amount || valorMatricula,

      // Link do boleto completo da Cora, caso você queira manter disponível
      boleto_url: boletoUrl,

      // Mantido como null para não confundir com imagem do QR Code
      // O QR Code nítido será gerado no front-end a partir do Pix copia e cola
      qr_code_url: null,

      // Código Pix copia e cola usado para gerar o QR Code no WordPress
      pix_copia_e_cola: pixCopiaECola
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