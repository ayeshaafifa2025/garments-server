const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000

const admin = require("firebase-admin");

// const serviceAccount = require("./garments-client-firebase-adminsdk.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// middleware
app.use(express.json());
app.use(cors());


const verifyFBToken = async (req, res, next) => {
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
    await client.connect();
    const db = client.db('garments_order_db');
    const userCollection = db.collection('users');
    const productCollection = db.collection('products');


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

// Home Page Products API
app.get('/products/homepage', async (req, res) => {
    try {
        const cursor = productCollection.find({ showOnHome: true }).limit(6);
        
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