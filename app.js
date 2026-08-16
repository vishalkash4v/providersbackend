const createError = require('http-errors');
require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const fileUpload = require("express-fileupload");
const authRouter = require('./routes/auth');
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const { connectDB } = require('./utils/db');

const app = express();
const debug = require('debug')('providerbackend:server');
const http = require('http');

/**
 * Get port from environment and store in Express.
 */
const port = normalizePort(process.env.PORT || '3000');
const server = http.createServer(app);
app.set('port', port);

if (mongoose.connection.readyState === 0) {
  connectDB().catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
  });
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
// JSON body
app.use(express.json());

// URL-encoded body
app.use(express.urlencoded({ extended: true }));

// Multipart/form-data + files
app.use(
  fileUpload({
    createParentPath: true,

    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
    },

    abortOnLimit: true,

    // Keeps uploaded files in memory.
    // Your utility function will move them to disk.
    useTempFiles: false,
  })
);

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/api/auth', authRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

server.listen(port);
server.on('error', onError);
server.on('listening', onListening);
console.log(`Server is running on port ${port}`);

function normalizePort(val) {
  const port = parseInt(val, 10);
  if (isNaN(port)) {
    return val;
  }
  if (port >= 0) {
    return port;
  }
  return false;
}

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }
  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function onListening() {
  const addr = server.address();
  const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
  debug('Listening on ' + bind);
}

module.exports = app;