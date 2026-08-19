const createError = require('http-errors');
require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const http = require('http');

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const servicesRouter = require('./routes/services');
const providersRouter = require('./routes/providers');
const authRouter = require('./routes/auth');
const bookingRouter = require('./routes/booking');
const paymentRouter = require('./routes/payment');

const { connectDB } = require('./utils/db');

const app = express();
const debug = require('debug')('providerbackend:server');

/**
 * Get port from environment and store in Express.
 */
const port = normalizePort(
  process.env.PORT || '3000'
);

app.set('port', port);

const server = http.createServer(app);


// ============================================================
// CONNECT DATABASE
// ============================================================

connectDB().catch((err) => {
  console.error(
    'Failed to connect to MongoDB:',
    err.message
  );
});


// ============================================================
// VIEW ENGINE
// ============================================================

app.set(
  'views',
  path.join(__dirname, 'views')
);

app.set(
  'view engine',
  'ejs'
);


// ============================================================
// BASIC MIDDLEWARE
// ============================================================

app.use(
  logger('dev')
);

app.use(
  cookieParser()
);

app.use(
  express.urlencoded({
    extended: true,
  })
);


// ============================================================
// RAZORPAY WEBHOOK
// ============================================================
//
// IMPORTANT:
//
// This route MUST receive the raw request body.
// Razorpay webhook signature verification depends
// on the original raw body.
//
// Therefore this route is registered BEFORE
// express.json().
//
// ============================================================

app.use(
  '/api/payment/razorpay/webhook',
  bodyParser.raw({
    type: 'application/json',
  })
);


// ============================================================
// JSON BODY PARSER
// ============================================================

app.use(
  express.json()
);


// ============================================================
// STATIC FILES
// ============================================================

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


// ============================================================
// FILE UPLOAD MIDDLEWARE
// ============================================================

app.use(
  fileUpload({
    createParentPath: true,

    limits: {
      fileSize:
        10 * 1024 * 1024, // 10MB
    },

    abortOnLimit: true,

    useTempFiles: false,
  })
);


// ============================================================
// ROUTES
// ============================================================

app.use(
  '/',
  indexRouter
);

app.use(
  '/users',
  usersRouter
);

app.use(
  '/api/auth',
  authRouter
);

app.use(
  '/api/services',
  servicesRouter
);

app.use(
  '/api/provider',
  providersRouter
);

app.use(
  '/api/customer',
  usersRouter
);

app.use(
  '/api/booking',
  bookingRouter
);

app.use(
  '/api/payment',
  paymentRouter
);


// ============================================================
// UPLOADS STATIC
// ============================================================

app.use(
  '/uploads',
  express.static(
    path.resolve('uploads')
  )
);


// ============================================================
// 404
// ============================================================

app.use(
  function (req, res, next) {
    next(
      createError(404)
    );
  }
);


// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  function (
    err,
    req,
    res,
    next
  ) {
    res.locals.message =
      err.message;

    res.locals.error =
      req.app.get(
        'env'
      ) === 'development'
        ? err
        : {};

    res.status(
      err.status || 500
    );

    res.render(
      'error'
    );
  }
);


// ============================================================
// START SERVER
// ============================================================

server.listen(
  port
);

server.on(
  'error',
  onError
);

server.on(
  'listening',
  onListening
);

console.log(
  `Server is running on port ${port}`
);


// ============================================================
// NORMALIZE PORT
// ============================================================

function normalizePort(
  val
) {
  const port =
    parseInt(
      val,
      10
    );

  if (
    isNaN(port)
  ) {
    return val;
  }

  if (
    port >= 0
  ) {
    return port;
  }

  return false;
}


// ============================================================
// SERVER ERROR
// ============================================================

function onError(
  error
) {
  if (
    error.syscall !==
    'listen'
  ) {
    throw error;
  }

  const bind =
    typeof port ===
    'string'
      ? 'Pipe ' + port
      : 'Port ' + port;

  switch (
    error.code
  ) {
    case 'EACCES':
      console.error(
        bind +
          ' requires elevated privileges'
      );

      process.exit(
        1
      );

      break;

    case 'EADDRINUSE':
      console.error(
        bind +
          ' is already in use'
      );

      process.exit(
        1
      );

      break;

    default:
      throw error;
  }
}


// ============================================================
// SERVER LISTENING
// ============================================================

function onListening() {
  const addr =
    server.address();

  const bind =
    typeof addr ===
    'string'
      ? 'pipe ' + addr
      : 'port ' + addr.port;

  debug(
    'Listening on ' +
      bind
  );
}


module.exports = app;