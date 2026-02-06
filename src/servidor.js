if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const rotasBoletos = require('./rotas/rotasBoletos');

const app = express();
const PORTA = process.env.PORT;

// Configuração do CORS
const corsOptions = {
  origin: process.env.FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.get('/', (req, res) => {
  res.status(200).json({ mensagem: 'API OK', build: 'GET-CPF-ATIVO' });
});

app.use('/api/boletos', rotasBoletos);

app.use((req, res, next) => {
    console.warn(`⚠️ Rota não encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
    console.error('❌ Erro inesperado no servidor:', err.stack);
    res.status(500).json({ erro: 'Ocorreu um erro interno no servidor. Por favor, tente novamente mais tarde.' });
});

// Inicia o servidor
app.listen(PORTA, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORTA}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS permitido para: ${process.env.FRONTEND_URL || 'qualquer origem (CORS desabilitado ou não configurado)'}`);
});


