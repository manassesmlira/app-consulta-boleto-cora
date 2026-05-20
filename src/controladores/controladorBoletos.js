const servicoCora = require('../servicos/servicoCora');
const validadorCpf = require('../utilitarios/validadorCpf'); // Renomeado para 'validadorCpf' para consistência

const consultarBoletos = async (req, res) => {
    const { cpf } = req.body;

    // 1. Validação inicial do CPF
    if (!cpf) {
        console.warn('⚠️ Requisição recebida sem CPF.');
        return res.status(400).json({ erro: 'CPF é obrigatório.' });
    }

    // 2. Valida o formato e os dígitos do CPF
    if (!validadorCpf.validar(cpf)) {
        console.warn(`⚠️ Tentativa de consulta com CPF inválido: ${cpf}`);
        return res.status(400).json({ erro: 'CPF inválido. Por favor, verifique o número digitado.' });
    }

    // Limpa o CPF para garantir que apenas números sejam passados para o serviço
    const cpfLimpo = validadorCpf.limpar(cpf);

    try {
        // 3. Chama o serviço Cora para buscar os boletos.
        // O serviço já retorna os boletos atrasados e o próximo a vencer de forma estruturada.
        const { boletosAtrasados, proximoBoletoAVencer } = await servicoCora.consultarBoletosPorCpf(cpfLimpo);

        // 4. Verifica se nenhum boleto foi encontrado
        if (boletosAtrasados.length === 0 && !proximoBoletoAVencer) {
            console.log(`📄 Nenhum boleto ativo encontrado para o CPF: ${cpfLimpo}`);
            
            const mensagemHtml = `Até esse momento, nenhum boleto associado a esse CPF.<br><br>Se você é novo aluno, é possível que seus boletos ainda não tenham chegado no sistema. Entre em contato com a secretaria da escola clicando aqui: <a href="https://wa.me/5511982223315?text=Olá,%20sou%20novo%20aluno%20e%20não%20encontrei%20meus%20boletos." target="_blank" style="font-weight: bold; text-decoration: underline;">11 98222-3315</a>`;
            
            return res.status(200).json({ 
                mensagem: mensagemHtml,
                boletos: []
            });
        }

        // 5. Prepara a lista de boletos para a resposta, aplicando os status desejados
        let boletosParaExibir = [];

        // Adiciona todos os boletos atrasados, marcando-os como 'ATRASADO'
        boletosAtrasados.forEach(boleto => {
            boletosParaExibir.push({ ...boleto, status: 'ATRASADO' });
        });

        // Adiciona o próximo boleto a vencer, se existir e ainda não estiver na lista (para evitar duplicatas)
        if (proximoBoletoAVencer) {
            const isDuplicate = boletosParaExibir.some(b => b.id === proximoBoletoAVencer.id);
            if (!isDuplicate) {
                boletosParaExibir.push({ ...proximoBoletoAVencer, status: 'A VENCER' }); // Ou 'PENDENTE'
            }
        }

        // 6. Ordena a lista final de boletos para exibição
        // Prioriza boletos atrasados, depois ordena por data de vencimento (do mais antigo para o mais recente)
        boletosParaExibir.sort((a, b) => {
            // Boletos atrasados vêm primeiro
            if (a.status === 'ATRASADO' && b.status !== 'ATRASADO') return -1;
            if (a.status !== 'ATRASADO' && b.status === 'ATRASADO') return 1;
            // Se ambos são atrasados ou ambos são "a vencer", ordena pela data de vencimento
            return new Date(a.due_date) - new Date(b.due_date);
        });

        console.log(`✅ Boletos consultados com sucesso para o CPF: ${cpfLimpo}. Total de ${boletosParaExibir.length} boletos para exibir.`);
        return res.status(200).json({ boletos: boletosParaExibir });

    } catch (error) {
        console.error(`❌ Erro no controlador ao consultar boletos para o CPF ${cpfLimpo}:`, error.message);
        // Em caso de erro, retorna uma mensagem genérica para o cliente
        return res.status(500).json({ erro: 'Erro interno ao consultar boletos. Por favor, tente novamente mais tarde.' });
    }
};

module.exports = {
    consultarBoletos
};
