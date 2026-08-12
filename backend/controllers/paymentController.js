const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');

const generatePayFastSignature = (data, passphrase = '') => {
  const sortedKeys = Object.keys(data).sort();
  let encodedString = '';

  sortedKeys.forEach((key) => {
    const value = data[key];
    if (value !== undefined && value !== null && value !== '') {
      const encodedValue = encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
      encodedString += `${key}=${encodedValue}&`;
    }
  });

  if (passphrase) {
    const encodedPassphrase = encodeURIComponent(String(passphrase).trim()).replace(/%20/g, '+');
    encodedString += `passphrase=${encodedPassphrase}`;
  } else {
    encodedString = encodedString.slice(0, -1);
  }

  return crypto.createHash('md5').update(encodedString).digest('hex');
};

const getPayFastCheckoutUrl = () => {
  return process.env.PAYFAST_MODE === 'live'
    ? 'https://www.payfast.co.za/eng/process'
    : 'https://sandbox.payfast.co.za/eng/process';
};

const createOrder = async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!process.env.PAYFAST_MERCHANT_ID || !process.env.PAYFAST_MERCHANT_KEY) {
      return res.status(400).json({ message: 'PayFast credentials are not configured on the backend.' });
    }

    const sanitizedAmount = Number(amount || 0).toFixed(2);
    const payfastOrderId = orderId || `shopnova_${Date.now()}`;

    const payload = {
      merchant_id: String(process.env.PAYFAST_MERCHANT_ID),
      merchant_key: String(process.env.PAYFAST_MERCHANT_KEY),
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/ordersuccess?payment=payfast&order=${payfastOrderId}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout`,
      notify_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payment/notify`,
      m_payment_id: String(payfastOrderId),
      amount: sanitizedAmount,
      item_name: `ShopNova Order ${payfastOrderId}`,
      item_description: `Order ${payfastOrderId}`,
      email_address: req.user?.email || '',
      currency: 'ZAR'
    };

    payload.signature = generatePayFastSignature(payload, process.env.PAYFAST_PASSPHRASE || '');

    res.status(200).json({
      orderId: payfastOrderId,
      formUrl: getPayFastCheckoutUrl(),
      fields: payload
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const reduceStockForOrder = async (order) => {
  if (!order || !Array.isArray(order.items)) {
    return;
  }

  for (const item of order.items) {
    const product = await Product.findById(item.productId);

    if (!product) {
      throw new Error(`Product not found for item ${String(item.productId)}`);
    }

    if (product.stock < item.qty) {
      throw new Error(`Insufficient stock for product ${product.name}`);
    }

    product.stock -= item.qty;
    await product.save();
  }
};

const markOrderPaid = async (orderId, paymentData) => {
  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error('Order not found');
  }

  if (order.paymentStatus === 'Paid') {
    return order;
  }

  const expectedAmount = Number(order.totalAmount).toFixed(2);
  const actualAmount = Number(paymentData.amount).toFixed(2);

  if (expectedAmount !== actualAmount) {
    throw new Error('Order amount does not match PayFast payment amount');
  }

  if (paymentData.payment_status === 'COMPLETE') {
    await reduceStockForOrder(order);
  }

  order.paymentMethod = 'PayFast';
  order.paymentStatus = paymentData.payment_status === 'COMPLETE' ? 'Paid' : 'Failed';
  order.paymentId = paymentData.m_payment_id || paymentData.pf_payment_id || order.paymentId;
  order.transactionId = paymentData.pf_payment_id || paymentData.pf_payment_id || order.transactionId;

  if (paymentData.payment_status === 'COMPLETE') {
    order.status = 'Pending';
  }

  await order.save();
  return order;
};

const verifyPayment = async (req, res) => {
  try {
    const received = { ...req.body };
    const signature = received.signature || '';
    delete received.signature;

    const passphrase = process.env.PAYFAST_PASSPHRASE || '';
    const sortedKeys = Object.keys(received).sort();
    let encodedString = '';

    sortedKeys.forEach((key) => {
      const value = received[key];
      if (value !== undefined && value !== null && value !== '') {
        const encodedValue = encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
        encodedString += `${key}=${encodedValue}&`;
      }
    });

    if (passphrase) {
      const encodedPassphrase = encodeURIComponent(String(passphrase).trim()).replace(/%20/g, '+');
      encodedString += `passphrase=${encodedPassphrase}`;
    } else {
      encodedString = encodedString.slice(0, -1);
    }

    const expectedSignature = crypto.createHash('md5').update(encodedString).digest('hex');

    if (signature.toLowerCase() !== expectedSignature.toLowerCase()) {
      return res.status(400).json({ message: 'Invalid PayFast signature' });
    }

    const order = await Order.findById(received.m_payment_id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found for PayFast verification' });
    }

    if (req.user && order.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not own this order' });
    }

    if (received.payment_status !== 'COMPLETE') {
      order.paymentStatus = 'Failed';
      order.paymentMethod = 'PayFast';
      await order.save();
      return res.status(400).json({ message: 'Payment not complete' });
    }

    await markOrderPaid(received.m_payment_id, received);
    return res.status(200).json({ message: 'Payment verified successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const verifyPayFastNotification = async (req, res) => {
  try {
    const received = { ...req.body };
    const signature = received.signature || '';
    delete received.signature;

    const passphrase = process.env.PAYFAST_PASSPHRASE || '';
    const sortedKeys = Object.keys(received).sort();
    let encodedString = '';

    sortedKeys.forEach((key) => {
      const value = received[key];
      if (value !== undefined && value !== null && value !== '') {
        const encodedValue = encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
        encodedString += `${key}=${encodedValue}&`;
      }
    });

    if (passphrase) {
      const encodedPassphrase = encodeURIComponent(String(passphrase).trim()).replace(/%20/g, '+');
      encodedString += `passphrase=${encodedPassphrase}`;
    } else {
      encodedString = encodedString.slice(0, -1);
    }

    const expectedSignature = crypto.createHash('md5').update(encodedString).digest('hex');

    if (signature.toLowerCase() !== expectedSignature.toLowerCase()) {
      return res.status(400).send('Invalid PayFast signature');
    }

    if (received.payment_status !== 'COMPLETE') {
      const pendingOrder = await Order.findById(received.m_payment_id);
      if (pendingOrder) {
        pendingOrder.paymentStatus = 'Failed';
        pendingOrder.paymentMethod = 'PayFast';
        await pendingOrder.save();
      }
      return res.status(400).send('Payment not complete');
    }

    await markOrderPaid(received.m_payment_id, received);
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).send(error.message);
  }
};

module.exports = { createOrder, verifyPayment, verifyPayFastNotification, generatePayFastSignature };
