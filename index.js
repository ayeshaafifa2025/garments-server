const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000
const crypto = require("crypto");
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
function generateTrackingId() {
    const prefix = "ORD"; 
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); 
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); 

    return `${prefix}-${date}-${random}`;
}
// middleware
app.use(express.json());
app.use(cors(
   
));

// firebase  sdk
 const verifyFBToken = async (req, res, next) => {
// console.log('headers In the middleware',req.headers?.authorization)
    const token = req.headers.authorization;
    console.log(token)
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
        try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
}

 

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wstr9pt.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const db = client.db('garments_order_db');
    const userCollection = db.collection('users');
    const productCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
        const trackingsCollection = db.collection('trackings');
         const paymentCollection = db.collection('payments');
const logTracking = async (trackingId, status, location = 'N/A', note = '') => {
    const detailsText = `${status}${location !== 'N/A' ? ` at ${location}` : ''}${note ? ` (${note})` : ''}`;
    const log = {
        trackingId,
        status,
        location, 
        note,     
        details: detailsText,
        createdAt: new Date()
    }
    
  
    const result = await trackingsCollection.insertOne(log); 
    return result;
}
 const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }
           const verifyManager = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'manager') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }
        const verifyBuyer = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'buyer') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }
const verifyAdminOrManager = async (req, res, next) => {
    const email = req.decoded_email;
    const query = { email };
    const user = await userCollection.findOne(query);

    if (!user) {
        return res.status(403).send({ message: 'Forbidden access: User not found.' });
    }

    const role = user.role;
    
    if (role === 'admin' || role === 'manager') {
        next();
    } else {
        return res.status(403).send({ message: 'Forbidden access: Must be an Admin or Manager.' });
    }
};
const verifyBuyerOrManager = async (req, res, next) => {
    const email = req.decoded_email; 
    const query = { email };
    const user = await userCollection.findOne(query); 

    if (!user) {
        return res.status(403).send({ message: 'Forbidden access: User not found.' });
    }

    const role = user.role;
    
  
    if (role === 'buyer' || role === 'manager' || role === 'admin') { 
        next();
    } else {
        return res.status(403).send({ message: 'Forbidden access: Must be a Buyer, Manager, or Admin.' });
    }
};
const verifyActiveStatus = async (req, res, next) => {

    const email = req.decoded_email; 
    const query = { email };
    const user = await userCollection.findOne(query); 

    if (user && user.status === 'suspended') {
      
        return res.status(403).send({ 
            message: 'Forbidden access: Your account is suspended and cannot perform this action.' 
        });
    }
    
  
    next();
};


app.get('/admin/dashboard-stats', verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const [totalUsers, totalProducts, totalOrders] = await Promise.all([
            userCollection.countDocuments(),
            productCollection.countDocuments(),
            ordersCollection.countDocuments()
        ]);
        const userRoles = await userCollection.aggregate([
            { $group: { _id: '$role', count: { $sum: 1 } } }
        ]).toArray();
        const orderStatuses = await ordersCollection.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();
        const productCategories = await productCollection.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } } 
        ]).toArray();

        res.send({
            totalUsers,
            totalProducts,
            totalOrders,
            userRoles,
            orderStatuses,
            productCategories
        });

    } catch (error) {
        console.error("Error fetching admin dashboard stats:", error);
        res.status(500).send({ message: 'Failed to retrieve admin dashboard stats' });
    }
});

app.get('/manager/dashboard-stats', verifyFBToken, verifyManager, async (req, res) => {
    try {
        const managerEmail = req.decoded_email; 

        const [totalProducts, pendingOrdersCount, approvedOrdersCount] = await Promise.all([
            productCollection.countDocuments({ managerEmail }),
            ordersCollection.countDocuments({ managerEmail, status: 'Pending' }),
            ordersCollection.countDocuments({ managerEmail, status: 'Approved' })
        ]);

       
        const stockStats = await productCollection.aggregate([
            { $match: { managerEmail } }, 
            {
                $project: {
                    stockStatus: {
                        $cond: {
                            if: { $lte: ['$availableQuantity', 10] }, 
                            then: 'Low Stock',
                            else: 'In Stock'
                        }
                    }
                }
            },
            { $group: { _id: '$stockStatus', count: { $sum: 1 } } }
        ]).toArray();

      
        const trackingStats = await ordersCollection.aggregate([
            { $match: { managerEmail, status: 'Approved' } }, 
            { $group: { _id: '$currentTrackingStatus', count: { $sum: 1 } } }
        ]).toArray();
        
        res.send({
            totalProducts,
            pendingOrdersCount,
            approvedOrdersCount,
            stockStats,
            trackingStats
        });

    } catch (error) {
        console.error("Error fetching manager dashboard stats:", error);
        res.status(500).send({ message: 'Failed to retrieve manager dashboard stats' });
    }
});


app.get('/buyer/dashboard-stats', verifyFBToken, verifyBuyer, async (req, res) => {
    try {
        const buyerEmail = req.decoded_email; 

       
        const [totalOrders, pendingOrders, approvedOrders, deliveredOrders] = await Promise.all([
            ordersCollection.countDocuments({ buyerEmail }),
            ordersCollection.countDocuments({ buyerEmail, status: 'Pending' }),
            ordersCollection.countDocuments({ buyerEmail, status: 'Approved' }),
            ordersCollection.countDocuments({ buyerEmail, status: 'Delivered' })
        ]);

      
        const statusStats = await ordersCollection.aggregate([
            { $match: { buyerEmail } }, 
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();
        
        res.send({
            totalOrders,
            pendingOrders,
            approvedOrders,
            deliveredOrders,
            statusStats
        });

    } catch (error) {
        console.error("Error fetching buyer dashboard stats:", error);
        res.status(500).send({ message: 'Failed to retrieve buyer dashboard stats' });
    }
});

     app.post('/orders',verifyFBToken,verifyBuyer, async (req, res) => {
            const order = req.body;
            const trackingId = generateTrackingId();
           
            order.createdAt = new Date();
            order.trackingId = trackingId;

            logTracking(trackingId, 'pending');

            const result = await ordersCollection.insertOne(order);
            res.send(result)
        })
       app.get('/orders/by-id/:id',verifyFBToken,verifyBuyerOrManager, async (req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            return res.status(400).send({ message: 'Order ID is required.' });
        }
        
        const query = { _id: new ObjectId(id) };
        const order = await ordersCollection.findOne(query);

        if (!order) {
            return res.status(404).send({ message: 'Order not found.' });
        }

        res.send(order);
    } catch (error) {
        console.error("Error fetching single order by ID:", error);
        res.status(500).send({ message: 'Failed to retrieve order' });
    }
}); 
app.get('/orders/:email',verifyFBToken,verifyBuyer, async (req, res) => {
    try {
        const email = req.params.email;
        // console.log(req.headers)

        if (!email) {
            return res.status(400).send({ message: 'Email parameter is required.' });
        }

       if(email !== req.decoded_email){
    return res.status(403).send({message:'forbidden access'})

}
        
       
        const query = { buyerEmail: email };
        const orders = await ordersCollection.find(query).toArray();

        res.send(orders);
    } catch (error) {
        console.error("Error fetching user orders:", error);
        res.status(500).send({ message: 'Failed to retrieve orders' });
    }
});
app.get('/manager-approved-orders',verifyFBToken,verifyManager, async (req, res) => {
    try {
        const managerEmail = req.query.email; 
        
        const APPROVED_STATUS = 'Approved'; 

        if (!managerEmail) {
            return res.status(400).send({ message: 'Manager Email query parameter is required.' });
        }

     
        const query = { 
            managerEmail: managerEmail,
            status: APPROVED_STATUS
        };
        

        const cursor = ordersCollection.find(query).sort({ approvedAt: -1 });
        const approvedOrders = await cursor.toArray();
        
        res.send(approvedOrders);
    } catch (error) {
        console.error("Error fetching manager approved orders:", error); 
        res.status(500).send({ message: 'Failed to fetch approved orders' });
    }
});
app.patch('/orders/:id/tracking', verifyFBToken,verifyManager,async (req, res) => {
    try {
        const id = req.params.id;
        const { newLogStatus, location = 'N/A', note = '' } = req.body; 

        if (!id || !newLogStatus) {
            return res.status(400).send({ message: 'Order ID and newLogStatus are required.' });
        }

      
        const newLog = {
            status: newLogStatus,
            location: location,
            note: note,
            timestamp: new Date()
        };
        
        const updateDoc = {
            $push: { trackingLogs: newLog },
            $set: { 
                ...(newLogStatus === 'Delivered' && { status: 'Delivered', deliveredAt: new Date() }),
                currentTrackingStatus: newLogStatus
            }
        };

        const result = await ordersCollection.updateOne( 
            { _id: new ObjectId(id) },
            updateDoc
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ message: 'Order not found.' });
        }

        if (result.modifiedCount > 0) {
    
    const updatedOrder = await ordersCollection.findOne({ _id: new ObjectId(id) });
    
    if (updatedOrder && updatedOrder.trackingId) {
        
        await logTracking(updatedOrder.trackingId, newLogStatus, location, note); 
        
    } else {
        console.warn(`Tracking ID not found for Order ID: ${id}. Cannot log to trackingsCollection.`);
    }
}
        
        res.send({ success: true, message: `Tracking status updated to ${newLogStatus}`, result });

    } catch (error) {
        console.error("Error updating tracking status:", error); 
        res.status(500).send({ message: 'Failed to update tracking status' });
    }
});
app.get('/trackings/:trackingId',verifyFBToken,verifyBuyerOrManager, async (req, res) => {
    try {
        const trackingId = req.params.trackingId;
        if (!trackingId) {
            return res.status(400).send({ message: 'Tracking ID is required.' });
        }
        
        const query = { trackingId: trackingId };
        const trackings = await trackingsCollection.find(query).sort({ createdAt: 1 }).toArray(); 

        res.send(trackings);
    } catch (error) {
        console.error("Error fetching tracking logs:", error);
        res.status(500).send({ message: 'Failed to retrieve tracking logs' });
    }
});
app.patch('/orders/cancel/:id',verifyFBToken,verifyBuyer, async (req, res) => {
    try {
        const id = req.params.id;
        
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid order ID format' });
        }
        
        const filter = { 
            _id: new ObjectId(id),
            status: 'Pending' 
        };
        
        const updateDoc = {
            $set: {
                status: 'Cancelled',
                cancelledAt: new Date() 
            }
        };
        
        const result = await ordersCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
           
            const existingOrder = await ordersCollection.findOne({ _id: new ObjectId(id) });
            
            if (existingOrder && existingOrder.status !== 'Pending') {
                 return res.send({ 
                    success: false, 
                    message: `Order is already ${existingOrder.status}. Cannot cancel.` 
                });
            }
            return res.status(404).send({ success: false, message: 'Order not found or already processed.' });
        }

        if (result.modifiedCount > 0) {
         
            const updatedOrder = await ordersCollection.findOne({ _id: new ObjectId(id) });
            if (updatedOrder) {
                await logTracking(updatedOrder.trackingId, 'order_cancelled');
            }
            
            return res.send({ success: true, message: 'Order cancelled successfully.' });
        }
        
        res.send({ success: false, message: 'Order status was not updated.' });

    } catch (error) {
        console.error("Error cancelling order:", error);
        res.status(500).send({ message: 'Failed to cancel order', error: error.message });
    }
});
app.get('/manager-pending-orders',verifyFBToken,verifyManager,async (req, res) => {
    try {
        const managerEmail = req.query.email; 
        const PENDING_STATUS = 'Pending'; 

        if (!managerEmail) {
            return res.status(400).send({ message: 'Manager Email query parameter is required.' });
        }

        const query = { 
            managerEmail: managerEmail,
            status: PENDING_STATUS
        };
        

        const cursor = ordersCollection.find(query).sort({ createdAt: -1 });
        const pendingOrders = await cursor.toArray();
        
        res.send(pendingOrders);
    } catch (error) {
        console.error("Error fetching manager pending orders:", error); 
        res.status(500).send({ message: 'Failed to fetch pending orders' });
    }
});
app.patch('/orders/:id/status',verifyFBToken,verifyActiveStatus, async (req, res) => {
    try {
        const id = req.params.id;

        const { newStatus, trackingId } = req.body; 

        if (!id || !newStatus || !trackingId) {
            return res.status(400).send({ message: 'Invalid ID, newStatus, or trackingId provided.' });
        }
        
        const updateDoc = {
            $set: {
                status: newStatus,
           
                ...(newStatus === 'Approved' && { approvedAt: new Date() }), 
            }
        };
        
        const result = await ordersCollection.updateOne(
            { _id: new ObjectId(id) }, 
            updateDoc
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ message: 'Order not found.' });
        }

  
        if (result.modifiedCount > 0) {
            let logStatus;
            if (newStatus === 'Approved') {
                logStatus = 'Approved';
            } else if (newStatus === 'Rejected') {
                logStatus = 'Rejected';
            } else {
              
                logStatus = newStatus; 
            }
            
            
            await logTracking(trackingId, logStatus); 
        }

        res.send({ success: true, message: `Status updated to ${newStatus}`, result });

    } catch (error) {
        console.error("Error updating order status:", error); 
        res.status(500).send({ message: 'Failed to update order status' });
    }
});
app.post('/payment-checkout-session',verifyFBToken,verifyBuyer, async (req, res) => {
    const orderInfo = req.body;
    

    const trackingId = generateTrackingId();
    

    const amount = parseInt(orderInfo.finalPrice * 100); 


    const essentialOrderData = {
        productId: orderInfo.productId, 
        buyerEmail: orderInfo.buyerEmail, 
        
   
        finalPrice: orderInfo.finalPrice, 
        orderQuantity: orderInfo.orderQuantity, 
        perPiecePrice: orderInfo.perPiecePrice,
        
     
        managerName: orderInfo.managerName, 
        managerEmail: orderInfo.managerEmail, 
        productTitle: orderInfo.productTitle,
        firstName: orderInfo.firstName,
        lastName: orderInfo.lastName,
        
       
        deliveryAddress: orderInfo.deliveryAddress,
        contactNumber: orderInfo.contactNumber,
        additionalNotes: orderInfo.additionalNotes || '', 
    };
    
    const essentialOrderDataString = JSON.stringify(essentialOrderData);

    try {
        const session = await stripe.checkout.sessions.create({
            line_items: [
                { 
                    price_data: {
                        currency: 'usd',
                        unit_amount: amount,
                        product_data: {
                            name: `Payment for: ${orderInfo.productTitle}` 
                        }
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            metadata: {
               
                orderData: essentialOrderDataString, 
                trackingId: trackingId, 
            },
            
            customer_email: orderInfo.buyerEmail, 
            success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });

    } catch (error) {
        console.error("Stripe Session Creation Error:", error);
        res.status(500).send({ error: error.message });
    }
});
app.post('/payment-success', verifyFBToken, verifyBuyer, async (req, res) => { 
    const sessionId = req.query.session_id;
    
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
        const paymentExist = await paymentCollection.findOne({ transactionId });
        if (paymentExist) {
            return res.send({
                success: true,
                message: 'already exists', 
                transactionId,
                trackingId: paymentExist.trackingId
            });
        }
        
        const trackingId = session.metadata.trackingId; 

        if (session.payment_status === 'paid') {
            
            const essentialOrderData = JSON.parse(session.metadata.orderData);
            
            let managerPhoto = null;
            if (essentialOrderData.productId) {
                
                const product = await productCollection.findOne({ _id: new ObjectId(essentialOrderData.productId) });
                managerPhoto = product ? product.managerPhoto : null;
            }
        
            const newOrder = {
                ...essentialOrderData, 
                
                managerPhoto: managerPhoto, 
                
                trackingId: trackingId,
                paymentStatus: 'Paid',
                status: 'Pending', 
                transactionId: transactionId,
                createdAt: new Date(),
            };

            const resultOrder = await ordersCollection.insertOne(newOrder);
   
            if(resultOrder.insertedId){
                await logTracking(trackingId, 'Pending'); 
            }
            
            const payment = {
                amount: session.amount_total / 100,
                currency: session.currency,
                customerEmail: session.customer_email,
                orderId: resultOrder.insertedId,
                transactionId: transactionId,
                paymentStatus: session.payment_status,
                paidAt: new Date(),
                trackingId: trackingId
            };
            
            await paymentCollection.insertOne(payment);

            return res.send({
                success: true,
                trackingId: trackingId,
                transactionId: transactionId,
            });
        }
        return res.send({ success: false, message: "Payment status is not 'paid'." });

    } catch (error) {
        console.error("Payment Success Handler Error:", error);
        res.status(500).send({ success: false, error: "Server failed to process payment success." });
    }
});

app.post('/users',verifyFBToken, async (req, res) => {
    try {
        const userInfo = req.body; 
        const email = userInfo.email;
       
        const demandedRole = userInfo.demandedRole; 

        const query = { email: email };
        const currentTime = new Date().toISOString(); 
        
        const userExists = await userCollection.findOne(query);

        if (userExists) {
          
            const updateDoc = {
                $set: {
                    last_loggedIn: currentTime,
                },
            };
            
            const updateResult = await userCollection.updateOne(query, updateDoc);
            
            return res.send({ 
                message: 'User already exists, last_loggedIn updated.',
                updatedCount: updateResult.modifiedCount 
            });
        }

        
        const newUserInfo = {
            displayName: userInfo.displayName,
            email: userInfo.email,
            photoURL: userInfo.photoURL,
            role: 'user',
            demandedRole: demandedRole, 
            status: 'pending', 
            created_at: currentTime,
            last_loggedIn: currentTime,
        };
        
        const result = await userCollection.insertOne(newUserInfo);
        
        res.send(result);

    } catch (error) {
        console.error("Error processing user info:", error);
        res.status(500).send({ message: 'Failed to process user data' });
    }
});
app.patch('/users/update-status/:id', verifyFBToken,verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const updateFields = req.body; 

     

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: updateFields,
        };

        const result = await userCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
            res.send({ modifiedCount: result.modifiedCount, message: 'User status/role updated successfully.' });
        } else {
            res.status(400).send({ modifiedCount: 0, message: 'User not found or no changes made.' });
        }
    } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).send({ message: 'Failed to update user status/role' });
    }
});

app.get('/users/:email/status-role-info', verifyFBToken, async (req, res) => {
    try {
        const email = req.params.email;
        
       
        const query = { email: email };
        
      
        const user = await userCollection.findOne(query, { projection: { role: 1, status: 1, suspendReason: 1, suspendFeedback: 1 } }); 

        if (user) {
            res.send({ 
                role: user.role, 
                status: user.status, 
                suspendReason: user.suspendReason || null,
                suspendFeedback: user.suspendFeedback || null
            });
        } else {
            
            res.status(404).send({ 
                role: 'user', 
                status: 'pending', 
                message: 'User not found in DB.' 
            });
        }

    } catch (error) {
        console.error("Error fetching user role/status info:", error);
        res.status(500).send({ message: 'Failed to retrieve user info' });
    }
});

app.get('/users/all', verifyFBToken,verifyAdmin, async (req, res) => {
    try {
        const { search, role, status } = req.query; 
        let query = {}; 
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { displayName: { $regex: searchRegex } },
                { email: { $regex: searchRegex } }
            ];
        }

        if (role && role !== 'all') {
            query.role = role;
        }
        if (status && status !== 'all') {
           
            query.status = status;
        }

    
        const users = await userCollection.find(query).toArray();
        
        res.send(users);

    } catch (error) {
        console.error("Error fetching all users with filter:", error);
        res.status(500).send({ message: 'Failed to retrieve user data' });
    }
});

app.post('/products',verifyFBToken,verifyManager, async (req, res) => {
    try {
        const product = req.body;
        console.log(req.body)
        product.createdAt = new Date();

        const result = await productCollection.insertOne(product);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: 'Product insert failed' });
    }
});
app.delete('/products/:id',verifyFBToken, verifyAdminOrManager,async (req, res) => {
    try {
        const id = req.params.id;
        
      
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid product ID format.' });
        }
        
        const query = { _id: new ObjectId(id) };
        
        const result = await productCollection.deleteOne(query); 
        
        if (result.deletedCount === 0) {
            return res.status(404).send({ message: 'Product not found.' });
        }
        
        res.send(result);
    } catch (error) {
        // console.error('Error deleting product:', error);
        res.status(500).send({ message: 'Failed to delete product.' });
    }
});
app.get('/manager-products',verifyFBToken,verifyManager, async (req, res) => {
    try {
        const email = req.query.email; 

        if (!email) {
            
            return res.status(400).send({ message: 'Email query parameter is required.' });
        }

        const query = { 
            managerEmail: email 
        };
        
      
        const cursor = productCollection.find(query).sort({ createdAt: -1 });
        const products = await cursor.toArray();
        
        res.send(products);
    } catch (error) {
        console.error("Error fetching manager products:", error); 
        res.status(500).send({ message: 'Failed to fetch manager products' });
    }
});

app.get('/products', async (req, res) => {
    try {
       
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10; 

      
        const skip = (page - 1) * size;
        
       
        const count = await productCollection.countDocuments({});

      
        const cursor = productCollection.find({})
            .skip(skip) 
            .limit(size); 
            
        const products = await cursor.toArray();

        
        res.send({ products, count });
        
    } catch (error) {
        console.error("Error fetching all products with pagination:", error);
        res.status(500).send({ message: 'Failed to fetch products with pagination' });
    }
});

app.patch('/products/:id/toggle-home', verifyFBToken,verifyAdmin, async (req, res) => {
  
    const id = req.params.id;
    const { showOnHome } = req.body;
    
    if (!ObjectId.isValid(id) || typeof showOnHome !== 'boolean') {
        return res.status(400).send({ message: 'Invalid ID or status format' });
    }

    try {
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: {
                showOnHome: showOnHome,
            },
        };

        const result = await productCollection.updateOne(query, updateDoc);
        res.send(result);
    } catch (error) {
        console.error("Error toggling showOnHome status:", error);
        res.status(500).send({ message: 'Failed to update product status' });
    }
});
app.get('/all-products',verifyFBToken,verifyAdmin, async (req, res) => {
    try {
        const cursor = productCollection.find({});
        const result = await cursor.toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching all products:", error);
        res.status(500).send({ message: 'Failed to fetch all products' });
    }
});
app.get('/admin/all-orders',verifyFBToken,verifyAdmin, async (req, res) => {
    try {
        const statusFilter = req.query.status; 
        
        let query = {};

        if (statusFilter) {
            if (statusFilter === 'Approved') {
         
                query = { 
                    status: 'Approved', 
                    $or: [
                        { currentTrackingStatus: { $exists: false } },
                        { currentTrackingStatus: null },              
                        { currentTrackingStatus: "" },                
                        { currentTrackingStatus: 'Approved' }          
                    ]
                };

            } else if (statusFilter === 'Pending' || statusFilter === 'Rejected' || statusFilter === 'Cancelled' || statusFilter === 'Delivered') {
               
                query = { status: statusFilter };

            } else {
            
                query = { currentTrackingStatus: statusFilter };
            }
        }
        
        const orders = await ordersCollection.find(query).sort({ _id: -1 }).toArray();
        res.send(orders);
    } catch (error) {
        console.error("Error fetching all orders for admin:", error);
        res.status(500).send({ message: 'Failed to retrieve all orders' });
    }
});
app.patch('/products/:id',verifyFBToken,verifyAdminOrManager, async (req, res) => {
    try {
        const id = req.params.id;
        const updatedProductData = req.body; 
        
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid product ID format.' });
        }

        const filter = { _id: new ObjectId(id) };
        const options = { upsert: false }; 

        
        const { _id, managerEmail, ...dataToUpdate } = updatedProductData;
        

        const updateDoc = {
            $set: {
                ...dataToUpdate,
            lastUpdated: new Date()
            },
        };

        const result = await productCollection.updateOne(filter, updateDoc, options);

        if (result.matchedCount === 0) {
            return res.status(404).send({ message: 'Product not found for update.' });
        }
        
        res.send(result);
    } catch (error) {
        // console.error('Error patching product:', error);
        res.status(500).send({ message: 'Failed to update product.' });
    }
});
app.get('/products/:id', async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid product ID format' });
    }
    try {
        const query = { _id: new ObjectId(id) };
        const result = await productCollection.findOne(query);

        if (!result) {
            return res.status(404).send({ message: 'Product not found' });
        }

        res.send(result);
    } catch (error) {
        console.error(`Error fetching product ID ${id}:`, error);
        res.status(500).send({ message: 'Failed to fetch product details' });
    }
});

app.get('/our-products/homepage', async (req, res) => {
    try {
        const cursor = productCollection.find({ showOnHome: true })
        .limit(6)
        ;
        
        const result = await cursor.toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching homepage products:", error);
        res.status(500).send({ message: 'Failed to fetch homepage products' });
    }
});

    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send(' Server is running')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})