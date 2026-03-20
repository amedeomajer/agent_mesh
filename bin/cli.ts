const command = process.argv[2];

switch (command) {
  case 'start':
    await import('../src/broker/index.js');
    break;

  case 'status': {
    const { default: WebSocket } = await import('ws');
    const port = process.env.BROKER_PORT || '4200';
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('open', () => {
      console.log(`Broker is running on ws://localhost:${port}`);
      ws.close();
      process.exit(0);
    });
    ws.on('error', () => {
      console.log('Broker is not running.');
      process.exit(1);
    });
    break;
  }

  default:
    console.log('Usage: agent-mesh <start|status>');
    console.log('');
    console.log('  start   Start the broker');
    console.log('  status  Check if the broker is running');
    break;
}
