const fs = require('fs');
const { execSync } = require('child_process');

const forbidden = ['pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'redis', 'ioredis', 'net', 'tls', 'amqplib'];

try {
  const files = execSync('find . -name "*.ts" -o -name "*.js" | grep -v node_modules')
    .toString()
    .split('\n')
    .filter(Boolean);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const dep of forbidden) {
      if (content.includes(`import.*${dep}`) || content.includes(`require.*${dep}`)) {
        console.error(`Forbidden import ${dep} found in ${file}`);
        process.exit(1);
      }
    }
  }
  
  console.log('✅ No forbidden imports found');
} catch (error) {
  console.error('Error checking forbidden imports:', error.message);
  process.exit(1);
}