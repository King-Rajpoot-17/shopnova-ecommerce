import React, { useState, useContext } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { clearCart } from '../redux/cartSlice';

const Checkout = () => {
  const { user } = useContext(AuthContext);
  const cartItems = useSelector((state) => state.cart.cartItems);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [address, setAddress] = useState({
    fullName: '', street: '', city: '', postalCode: '', country: ''
  });
  const [paymentMethod, setPaymentMethod] = useState('payfast');

  const totalPrice = cartItems.reduce((acc, item) => acc + item.price * item.qty, 0);

  const handlePayFastPayment = async () => {
    try {
      const pendingOrderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({
          items: cartItems,
          totalAmount: totalPrice,
          address,
          paymentMethod: 'PayFast',
          paymentStatus: 'Pending',
          paymentId: `pending_payfast_${Date.now()}`
        })
      });

      const pendingOrderData = await pendingOrderRes.json();

      if (!pendingOrderRes.ok) {
        throw new Error(pendingOrderData.message || 'Unable to create pending PayFast order');
      }

      const payfastRes = await fetch('/api/payment/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({
          amount: totalPrice,
          orderId: pendingOrderData._id,
          email: user?.email
        })
      });

      const payfastData = await payfastRes.json();

      if (!payfastRes.ok) {
        const fallback = window.confirm('PayFast is not configured. Use the existing demo bypass option instead?');
        if (fallback) {
          return bypassPayment();
        }
        return alert(payfastData.message || 'PayFast payment failed to initialize');
      }

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = payfastData.formUrl;
      Object.entries(payfastData.fields).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      console.error(error);
      alert(error.message || 'Unable to initialize PayFast checkout');
    }
  };

  const bypassPayment = async () => {
    const saveOrderRes = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.token}`
      },
      body: JSON.stringify({
        items: cartItems,
        totalAmount: totalPrice,
        address,
        paymentId: 'bypass_txn_' + Date.now(),
        paymentMethod: 'BYPASS',
        paymentStatus: 'BYPASS',
        transactionId: 'bypass_demo_txn_' + Date.now()
      })
    });

    if (saveOrderRes.ok) {
      dispatch(clearCart());
      navigate('/ordersuccess?payment=bypass');
    } else {
      const errorData = await saveOrderRes.json();
      alert(errorData.message || 'Demo bypass order failed');
    }
  };

  const handlePayment = async () => {
    if (paymentMethod === 'bypass') {
      return bypassPayment();
    }

    return handlePayFastPayment();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!user) {
      alert('Please login first');
      navigate('/login');
      return;
    }
    handlePayment();
  };

  return (
    <div className="checkout-container">
      <h2>Checkout</h2>
      <div className="checkout-content">
        <form onSubmit={handleSubmit} className="shipping-form">
          <h3>Shipping Address</h3>
          <input type="text" placeholder="Full Name" required value={address.fullName} onChange={(e) => setAddress({ ...address, fullName: e.target.value })} />
          <input type="text" placeholder="Street" required value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
          <input type="text" placeholder="City" required value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
          <input type="text" placeholder="Postal Code" required value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} />
          <input type="text" placeholder="Country" required value={address.country} onChange={(e) => setAddress({ ...address, country: e.target.value })} />

          <div style={{ marginTop: '20px', marginBottom: '20px' }}>
            <h4>Payment Method</h4>
            <label style={{ display: 'block', marginBottom: '8px' }}>
              <input
                type="radio"
                name="paymentMethod"
                value="payfast"
                checked={paymentMethod === 'payfast'}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
              PayFast
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="paymentMethod"
                value="bypass"
                checked={paymentMethod === 'bypass'}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
              Demo Bypass
            </label>
          </div>

          <div className="checkout-summary">
            <h4>Total to Pay: ₹{totalPrice.toFixed(2)}</h4>
            <button type="submit" className="btn">Pay Now</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Checkout;
