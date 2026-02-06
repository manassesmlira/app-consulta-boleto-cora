const express = require('express');
const router = express.Router(); // Alterado de 'rota' para 'router' por convenção
const controladorBoletos = require('../controladores/controladorBoletos');

// Rota para consultar boletos por CPF
// Método: POST
// Endpoint: /consultar-boletos (será prefixado por /api/boletos no servidor.js)
// Corpo da requisição (JSON): { "cpf": "123.456.789-00" }
router.get("/:cpf", (req, res) => {
  req.body = { cpf: req.params.cpf };
  return controladorBoletos.consultarBoletos(req, res);
});
router.post('/consultar-boletos', controladorBoletos.consultarBoletos);

module.exports = router;
