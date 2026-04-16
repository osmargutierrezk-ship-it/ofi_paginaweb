const express = require('express');
const path    = require('path');
const cors    = require('cors');
const db      = require('./src/db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',        require('./src/routes/auth'));
app.use('/api/solicitudes', require('./src/routes/solicitudes'));
app.use('/api/aprobaciones',require('./src/routes/aprobaciones'));
app.use('/api/dashboard',   require('./src/routes/dashboard'));
app.use('/api/push',        require('./src/routes/push'));
app.use('/api/usuarios',    require('./src/routes/usuarios'));

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

async function start() {
  try {
    const fs  = require('fs');
    const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await db.query(sql);
    console.log('✅ Base de datos inicializada');
  } catch (err) {
    console.error('❌ Error DB:', err.message);
  }
  app.listen(PORT, () => console.log(`🚀 PayFlow en puerto ${PORT}`));
}

start();
