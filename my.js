import Corestore from 'corestore';
import goodbye from 'graceful-goodbye';
import Hyperswarm from 'hyperswarm';
import Autobase from 'autobase';
import crypto from 'crypto';

const swarm = new Hyperswarm();
goodbye(() => swarm.destroy());

const file = process.argv?.[2];
const key = process.argv?.[3] || crypto.randomBytes;
if (!file) throw new Error('no file name specified in arg');

const store = new Corestore('./data' + file);
swarm.on('connection', (conn, info) => {
  console.log('connection', conn);
  // conn.on('open');
  store.replicate(conn);
});

const userCore = store.get({ name: 'core' });
const userOutput = store.get({ name: 'output', valueEncoding: 'json' });
const otherCore = key ? store.get({ key }) : undefined;

await Promise.all([userCore.ready(), userOutput.ready(), otherCore?.ready()]);

const base = new Autobase({
  inputs: [userCore].concat(otherCore || []),
  outputs: [userOutput, otherCore],
  localInput: userCore,
  localOutput: userOutput,
  autostart: true,
});

await base.ready();
// console.log(base.view);

swarm.join(userCore.discoveryKey);
swarm.join(otherCore.discoveryKey);

// The flushed promise will resolve when the topic has been fully announced to the DHT
await swarm.flush().then(() => {
  console.log('joined topic:', userCore.key.toString('hex'));
});

process.stdin.on('data', (data) => {
  base.append(data);
});

const readStream = base.createReadStream();
for await (const data of readStream) {
  console.log('old data:', data);
}

for await (const data of base.createReadStream({
  live: true,
  checkpoint: readStream.checkpoint,
})) {
  console.log('new data:', data);
}
