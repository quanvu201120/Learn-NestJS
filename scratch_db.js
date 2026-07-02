const { MongoClient } = require('mongodb');

async function main() {
  const uri = "mongodb://vuquan201120:Asd0338786210@ac-pqtscka-shard-00-00.vinnywq.mongodb.net:27017,ac-pqtscka-shard-00-01.vinnywq.mongodb.net:27017,ac-pqtscka-shard-00-02.vinnywq.mongodb.net:27017/NestJs-database?ssl=true&replicaSet=atlas-h97t1j-shard-0&authSource=admin&appName=Cluster0";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('NestJs-database');
    const collection = db.collection('systemdailystats');

    const stats = await collection.find({}).toArray();
    let totalR2 = 0;
    let totalCloudinary = 0;
    
    console.log(`Found ${stats.length} documents in systemdailystats`);
    stats.forEach(s => {
      console.log(`Date: ${s.date}, uploadBytesR2: ${s.uploadBytesR2}, uploadBytesCloudinary: ${s.uploadBytesCloudinary}`);
      totalR2 += (s.uploadBytesR2 || 0);
      totalCloudinary += (s.uploadBytesCloudinary || 0);
    });

    console.log(`Total uploadBytesR2: ${totalR2} (${(totalR2 / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Total uploadBytesCloudinary: ${totalCloudinary} (${(totalCloudinary / 1024 / 1024).toFixed(2)} MB)`);
    
  } finally {
    await client.close();
  }
}

main().catch(console.error);
