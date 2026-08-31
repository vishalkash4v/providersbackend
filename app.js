const createError = require('http-errors');
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const ensureDB = require('./middleware/db'); // 👉 Yeh line add karo
const paymentController =
  require('./controllers/paymentController');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const fileUpload = require('express-fileupload');
const http = require('http');

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const servicesRouter = require('./routes/services');
const providersRouter = require('./routes/providers');
const authRouter = require('./routes/auth');
const bookingRouter = require('./routes/booking');
const paymentRouter = require('./routes/payment');
const extrasRouter = require('./routes/extras');
const adminRouter = require('./routes/admin'); // 👉 Admin router import karo
const namezivoRouter = require('./routes/namezivo'); // 👉 Namezivo router import karo
const { connectDB } = require('./utils/db');

const app = express();
const debug = require('debug')('providerbackend:server');


// ============================================================
// 🔥 TEMPORARY RAZORPAY WEBHOOK TEST
// ============================================================
//
// IMPORTANT:
// This is ONLY a diagnostic test.
//
// We are intentionally NOT using:
// - bodyParser.raw()
// - paymentController
// - paymentRouter
// - ensureDB
//
// If Razorpay receives 200 from this route, we know the
// Vercel/Express request path itself is working.
//
// ============================================================

app.post(
  '/api/payment/razorpay/webhook',
  ensureDB,
  bodyParser.raw({
    type: 'application/json'
  }),
  paymentController.razorpayWebhook
);


// ============================================================
// GET PORT
// ============================================================

const port = normalizePort(
  process.env.PORT || '3000'
);

app.set('port', port);


// ============================================================
// HTTP SERVER
// ============================================================

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
// JSON BODY PARSER
// ============================================================
//
// IMPORTANT:
// We have temporarily removed the Razorpay raw-body
// middleware from here.
//
// This is intentional for the webhook diagnostic test.
//
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


// ============================================================
// PAYMENT ROUTES
// ============================================================
//
// NOTE:
// The webhook route is already registered ABOVE.
//
// Therefore this router will handle the other payment
// endpoints only.
//
// ============================================================

app.use(
  '/api/payment',
  paymentRouter
);


app.use(
  '/api/extras',
  extrasRouter
);



app.use('/api/admin', adminRouter);

app.use('/api/namezivo',namezivoRouter);

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
      req.app.get('env') === 'development'
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

function normalizePort(val) {

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

function onError(error) {

  if (
    error.syscall !== 'listen'
  ) {

    throw error;

  }

  const bind =
    typeof port === 'string'
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
    typeof addr === 'string'
      ? 'pipe ' + addr
      : 'port ' + addr.port;

  debug(
    'Listening on ' +
    bind
  );

}


module.exports = app;