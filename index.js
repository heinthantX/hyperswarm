import Corestore from 'corestore';
import goodbye from 'graceful-goodbye';
import Hyperswarm from 'hyperswarm';
import Autobase from 'autobase';

const swarm = new Hyperswarm();
goodbye(() => swarm.destroy());

const file = process.argv?.[2];
if (!file) throw new Error('no file name specified in arg');

const store = new Corestore('./data_' + file);
swarm.on('connection', (conn, info) => {
  console.log('connection');
  store.replicate(conn);
});

const userCore = store.get({ name: 'core' });
const index = store.get({ name: 'index' });
await index.ready();
const listeningCores = [];
for await (const value of index.createReadStream()) {
  const core = store.get({ key: value });
  await core.ready();
  swarm.join(core.discoveryKey);
  listeningCores.push(core);
}

const userOutput = store.get({ name: 'output', valueEncoding: 'utf-8' });

const base = new Autobase({
  inputs: [userCore].concat(listeningCores),
  // outputs: [userOutput],
  localInput: userCore,
  localOutput: userOutput,
  autostart: true,
});

await base.ready();
// console.log(base.view);

swarm.join(userCore.discoveryKey);

// The flushed promise will resolve when the topic has been fully announced to the DHT
await swarm.flush().then(() => {
  console.log('joined topic:', userCore.key.toString('hex'));
});

process.stdin.on('data', async (data) => {
  const keyRegex = /key: (.{64})/;
  const match = keyRegex.exec(data);
  console.log(match);
  if (match?.[1]) {
    const core = store.get({ key: match[1] });
    await core.ready();
    base.addInput(core);
    index.append(core.key);
    swarm.join(core.discoveryKey);
    return;
  }
  base.append(
    JSON.stringify({
      from: file,
      message: data.toString('utf-8').replace('\n', ''),
    })
  );
});

const readStream = base.createReadStream();
for await (const data of readStream) {
  const value = JSON.parse(data.value.toString('utf-8'));
  console.log(
    `\nfrom ${value.from == file ? 'me' : value.from} ${data.seq}: ${
      value.message
    }\n`
  );
  console.log(data.clock, data._id);
}

for await (const data of base.createReadStream({
  live: true,
  checkpoint: readStream.checkpoint,
})) {
  const value = JSON.parse(data.value.toString('utf-8'));
  console.log(
    `\n New from ${value.from == file ? 'me' : value.from} ${data.seq}: ${
      value.message
    }\n`
  );
  console.log(data.clock, data._id);
}
