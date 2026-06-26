const servicoCora = require('../servicos/servicoCora');
const validadorCpf = require('../utilitarios/validadorCpf');

// Importa??es dos novos servi?os
const servicoNotion = require('../servicos/servicoNotion');
const servicoEmail = require('../servicos/servicoEmail');

const gerarPixMatricula = async (req, res) => {
  const gatewaySecret = process.env.CP_CHECKOUT_GATEWAY_SECRET;
  const receivedSecret = req.headers['x-cp-checkout-secret'];

  if (gatewaySecret && receivedSecret !== gatewaySecret) {
    return res.status(401).json({
      erro: 'Acesso n?o autorizado ao gateway de matr?cula.'
    });
  }

  const {
    nome,
    cpf,
    email,
    whatsapp,
    plano,
    nome_plano,
    produto_nome,
    pedido_uuid,
    valor_matricula_centavos
  } = req.body;

  if (!nome || !cpf || !email || !whatsapp || !plano) {
    return res.status(400).json({
      erro: 'Nome, CPF, e-mail, WhatsApp e plano s?o obrigat?rios.'
    });
  }

  if (!validadorCpf.validar(cpf)) {
    return res.status(400).json({
      erro: 'CPF inv?lido.'
    });
  }

  const cpfLimpo = validadorCpf.limpar(cpf);

  let valorMatricula = 9990;
  let nomePlano = 'Bacharel Livre em Teologia';
  let valorOrigem = 'fallback_plano';

  switch (plano) {
    case 'bacharel-mec':
      valorMatricula = 19700;
      nomePlano = 'Bacharel em Teologia - Gradua??o';
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
        erro: 'Plano inv?lido.'
      });
  }

  if (valor_matricula_centavos !== undefined && valor_matricula_centavos !== null && valor_matricula_centavos !== '') {
    const valorRecebido = Number(valor_matricula_centavos);

    if (!Number.isInteger(valorRecebido) || valorRecebido < 1000 || valorRecebido > 100000) {
      return res.status(400).json({
        erro: 'Valor da matr?cula inv?lido.'
      });
    }

    valorMatricula = valorRecebido;
    valorOrigem = 'wordpress';
  }

  if (nome_plano) {
    nomePlano = String(nome_plano).trim();
  } else if (produto_nome) {
    nomePlano = String(produto_nome).trim();
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
      valorMatricula,
      pedidoUuid: pedido_uuid
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
      produto_nome: produto_nome || nomePlano,
      pedido_uuid: pedido_uuid || null,
      valor: valorMatricula,
      valor_origem: valorOrigem,
      id: cobranca.id,
      status: cobranca.status || 'OPEN',
      pix_copia_e_cola: pixCopiaECola,
      boleto_url: boletoUrl
    };

    // 2. Salva no Notion de forma isolada
    try {
      await servicoNotion.salvarMatriculaNoNotion(dadosMatricula);
      console.log(`? Matr?cula de ${nome} salva no Notion com sucesso.`);
    } catch (erroNotion) {
      console.error(
        '?? Falha ao salvar no Notion, mas o Pix seguir? normalmente:',
        erroNotion.message
      );
    }

    // 3. Envia o E-mail de forma isolada
    try {
      await servicoEmail.enviarNotificacaoMatricula(dadosMatricula);
      console.log(`? E-mail de notifica??o enviado para a secretaria (${nome}).`);
    } catch (erroEmail) {
      console.error(
        '?? Falha ao enviar e-mail, mas o Pix seguir? normalmente:',
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
      valor_origem: valorOrigem,

      // Link do boleto completo da Cora, caso voc? queira manter dispon?vel
      boleto_url: boletoUrl,

      // Mantido como null para n?o confundir com imagem do QR Code
      // O QR Code n?tido ser? gerado no front-end a partir do Pix copia e cola
      qr_code_url: null,

      // C?digo Pix copia e cola usado para gerar o QR Code no WordPress
      pix_copia_e_cola: pixCopiaECola
    });

  } catch (error) {
    console.error('Erro ao gerar Pix de matr?cula:', error.message);

    if (error.response) {
      console.error('Status da Cora:', error.response.status);
      console.error('Resposta da Cora:', JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({
      erro: 'N?o foi poss?vel gerar o Pix da matr?cula.'
    });
  }
};

module.exports = {
  gerarPixMatricula
};
