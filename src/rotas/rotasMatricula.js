const express = require('express');
const router = express.Router();
const controladorMatricula = require('../controladores/controladorMatricula');

router.post('/gerar-pix', controladorMatricula.gerarPixMatricula);

module.exports = router;