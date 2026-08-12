const express = require('express');
const { createOrder, verifyPayment, verifyPayFastNotification } = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/order', protect, createOrder);
router.post('/verify', protect, verifyPayment);
router.post('/notify', verifyPayFastNotification);

module.exports = router;
