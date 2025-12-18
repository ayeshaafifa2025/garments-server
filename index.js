const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000
const crypto = require("crypto");

// const admin = require("firebase-admin");
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

function generateTrackingId() {
    const prefix = "ORD"; // your brand prefix
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

    return `${prefix}-${date}-${random}`;
}


// middleware
app.use(express.json());
app.use(cors());


// const verifyFBToken = async (req, res, next) => {
//     const token = req.headers.authorization;
//     console.log(token)

//     if (!token) {
//         return res.status(401).send({ message: 'unauthorized access' })
//     }

//     try {
//         const idToken = token.split(' ')[1];
//         const decoded = await admin.auth().verifyIdToken(idToken);
//         console.log('decoded in the token', decoded);
//         req.decoded_email = decoded.email;
//         next();
//     }
//     catch (err) {
//         return res.status(401).send({ message: 'unauthorized access' })
//     }


// }

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
    await client.connect();
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


     app.post('/orders', async (req, res) => {
            const order = req.body;
            const trackingId = generateTrackingId();
           
            order.createdAt = new Date();
            order.trackingId = trackingId;

            logTracking(trackingId, 'pending');

            const result = await ordersCollection.insertOne(order);
            res.send(result)
        })

       app.get('/orders/by-id/:id', async (req, res) => {
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




app.get('/orders/:email', async (req, res) => {
    try {
        const email = req.params.email;
        if (!email) {
            return res.status(400).send({ message: 'Email parameter is required.' });
        }
        
       
        const query = { buyerEmail: email };
        const orders = await ordersCollection.find(query).toArray();

        res.send(orders);
    } catch (error) {
        console.error("Error fetching user orders:", error);
        res.status(500).send({ message: 'Failed to retrieve orders' });
    }
});



app.get('/manager-approved-orders', async (req, res) => {
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

app.patch('/orders/:id/tracking', async (req, res) => {
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


app.get('/trackings/:trackingId', async (req, res) => {
    try {
        const trackingId = req.params.trackingId;
        if (!trackingId) {
            return res.status(400).send({ message: 'Tracking ID is required.' });
        }
        
        const query = { trackingId: trackingId };
        const trackings = await trackingsCollection.find(query).sort({ createdAt: 1 }).toArray(); // পুরানো থেকে নতুন

        res.send(trackings);
    } catch (error) {
        console.error("Error fetching tracking logs:", error);
        res.status(500).send({ message: 'Failed to retrieve tracking logs' });
    }
});




app.patch('/orders/cancel/:id', async (req, res) => {
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

app.get('/manager-pending-orders', async (req, res) => {
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



app.patch('/orders/:id/status', async (req, res) => {
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

        // ⭐ ট্র্যাকিং লগ ফিক্স: স্ট্যাটাস আপডেট হলে logTracking ফাংশন কল করা হলো
        if (result.modifiedCount > 0) {
            let logStatus;
            if (newStatus === 'Approved') {
                logStatus = 'Approved';
            } else if (newStatus === 'Rejected') {
                logStatus = 'Rejected';
            } else {
                // ভবিষ্যতে অন্য কোনো স্ট্যাটাস যোগ হলে
                logStatus = newStatus; 
            }
            
            // logTracking ফাংশন কল করা হলো
            // logTracking ফাংশনটি আপনার তৈরি করা থাকতে হবে।
            await logTracking(trackingId, logStatus); 
        }

        res.send({ success: true, message: `Status updated to ${newStatus}`, result });

    } catch (error) {
        console.error("Error updating order status:", error); 
        res.status(500).send({ message: 'Failed to update order status' });
    }
});


app.post('/payment-checkout-session', async (req, res) => {
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
                // সংক্ষিপ্ত ডেটা পাঠানো হলো
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


app.post('/payment-success', async (req, res) => { 
    const sessionId = req.query.session_id;
    
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
        
        const paymentExist = await paymentCollection.findOne({ transactionId });
        if (paymentExist) {
            return res.send({
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
            
            // ⭐ নতুন যুক্ত করা লাইন: PayFirst অর্ডারের জন্য 'Pending' স্ট্যাটাস লগ করা
            if(resultOrder.insertedId){
                 await logTracking(trackingId, 'Pending'); 
            }
            // ⭐
            

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
            // logTracking(trackingId, 'order_paid'); 

            return res.send({
                success: true,
                trackingId: trackingId,
                transactionId: transactionId,
            });
        }
        return res.send({ success: false });

    } catch (error) {
        console.error("Payment Success Handler Error:", error);
        res.status(500).send({ success: false, error: "Server failed to process payment success." });
    }
});

// app.post('/payment-success', async (req, res) => { 
//     const sessionId = req.query.session_id;
    
//     try {
//         const session = await stripe.checkout.sessions.retrieve(sessionId);

//         const transactionId = session.payment_intent;
        
//         const paymentExist = await paymentCollection.findOne({ transactionId });
//         if (paymentExist) {
//             return res.send({
//                 message: 'already exists',
//                 transactionId,
//                 trackingId: paymentExist.trackingId
//             });
//         }
        
//         const trackingId = session.metadata.trackingId; 

//         if (session.payment_status === 'paid') {
            
          
//             const essentialOrderData = JSON.parse(session.metadata.orderData);
            

//             let managerPhoto = null;
//             if (essentialOrderData.productId) {
              
//                 const product = await productCollection.findOne({ _id: new ObjectId(essentialOrderData.productId) });
//                 managerPhoto = product ? product.managerPhoto : null;
//             }
        
//             const newOrder = {
//                 ...essentialOrderData, 
                
          
//                 managerPhoto: managerPhoto, 
                
              
//                 trackingId: trackingId,
//                 paymentStatus: 'Paid',
//                 status: 'Pending', 
//                 transactionId: transactionId,
//                 createdAt: new Date(),
//             };

//             const resultOrder = await ordersCollection.insertOne(newOrder);
            

//             const payment = {
//                 amount: session.amount_total / 100,
//                 currency: session.currency,
//                 customerEmail: session.customer_email,
//                 orderId: resultOrder.insertedId,
//                 transactionId: transactionId,
//                 paymentStatus: session.payment_status,
//                 paidAt: new Date(),
//                 trackingId: trackingId
//             };
            
//             await paymentCollection.insertOne(payment);
//             // logTracking(trackingId, 'order_paid'); 

//             return res.send({
//                 success: true,
//                 trackingId: trackingId,
//                 transactionId: transactionId,
//             });
//         }
//         return res.send({ success: false });

//     } catch (error) {
//         console.error("Payment Success Handler Error:", error);
//         res.status(500).send({ success: false, error: "Server failed to process payment success." });
//     }
// });
    // User related API


     app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = 'user';
            userInfo.createdAt = new Date();
            const email = userInfo.email;
            const userExists = await userCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists' })
            }

            const result = await userCollection.insertOne(userInfo);
          
            res.send(result);
        })

// Product related API
app.post('/products', async (req, res) => {
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



app.delete('/products/:id', async (req, res) => {
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


app.get('/manager-products', async (req, res) => {
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
        const cursor = productCollection.find({});
        const result = await cursor.toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching all products:", error);
        res.status(500).send({ message: 'Failed to fetch all products' });
    }
});


app.get('/products', async (req, res) => {
    try {
        const cursor = productCollection.find({});
        const result = await cursor.toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching all products:", error);
        res.status(500).send({ message: 'Failed to fetch all products' });
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


app.patch('/products/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updatedProductData = req.body; 
        
     
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: 'Invalid product ID format.' });
        }

        const filter = { _id: new ObjectId(id) };
        const options = { upsert: false }; 

        
        const { _id, sellerEmail, ...dataToUpdate } = updatedProductData;
        

        const updateDoc = {
            $set: {
                ...dataToUpdate,
            
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
// Home Page Products API
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


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send(' Server is running')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})