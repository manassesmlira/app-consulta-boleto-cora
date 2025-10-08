class ValidadorCpf {

    /**
     * Valida um número de CPF brasileiro.
     * @param {string} cpf - O número do CPF a ser validado (pode conter pontos e traços).
     * @returns {boolean} - Retorna true se o CPF for válido, false caso contrário.
     */
    validar(cpf) {
        if (!cpf) {
            console.warn('⚠️ CPF não fornecido para validação.');
            return false;
        }

        // Remove caracteres não numéricos
        const cpfLimpo = cpf.replace(/[^\d]/g, '');

        // Verifica se tem 11 dígitos
        if (cpfLimpo.length !== 11) {
            console.warn(`⚠️ CPF "${cpf}" inválido: deve ter 11 dígitos.`);
            return false;
        }

        // Verifica se todos os dígitos são iguais (CPFs inválidos por regra)
        if (/^(\d)\1{10}$/.test(cpfLimpo)) {
            console.warn(`⚠️ CPF "${cpf}" inválido: todos os dígitos são iguais.`);
            return false;
        }

        // Calcula o primeiro dígito verificador
        let soma = 0;
        for (let i = 0; i < 9; i++) {
            soma += parseInt(cpfLimpo.charAt(i)) * (10 - i);
        }
        let resto = 11 - (soma % 11);
        const digitoVerificador1 = (resto === 10 || resto === 11) ? 0 : resto;

        // Compara com o primeiro dígito verificador do CPF fornecido
        if (digitoVerificador1 !== parseInt(cpfLimpo.charAt(9))) {
            console.warn(`⚠️ CPF "${cpf}" inválido: primeiro dígito verificador incorreto.`);
            return false;
        }

        // Calcula o segundo dígito verificador
        soma = 0;
        for (let i = 0; i < 10; i++) {
            soma += parseInt(cpfLimpo.charAt(i)) * (11 - i);
        }
        resto = 11 - (soma % 11);
        const digitoVerificador2 = (resto === 10 || resto === 11) ? 0 : resto;

        // Compara com o segundo dígito verificador do CPF fornecido
        if (digitoVerificador2 !== parseInt(cpfLimpo.charAt(10))) {
            console.warn(`⚠️ CPF "${cpf}" inválido: segundo dígito verificador incorreto.`);
            return false;
        }

        console.log(`✅ CPF "${cpf}" validado com sucesso.`);
        return true;
    }

    /**
     * Limpa o CPF, removendo pontos e traços, deixando apenas números.
     * @param {string} cpf - O número do CPF a ser limpo.
     * @returns {string} - O CPF contendo apenas dígitos.
     */
    limpar(cpf) {
        if (!cpf) {
            return '';
        }
        return cpf.replace(/[^\d]/g, '');
    }
}

module.exports = new ValidadorCpf();
