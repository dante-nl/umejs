const logger = require('../lib/logger');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FORCE_COLOR = '1'; // Enable ANSI colours

function captureLoggerCall(fn) {
    let stdout = '',
        stderr = '',
        exitCode = null;
    const origExit = process.exit;
    const origStdout = process.stdout.write;
    const origStderr = process.stderr.write;

    process.exit = (code) => {
        exitCode = code;
    };
    process.stdout.write = (chunk) => {
        stdout += chunk;
        return true;
    };
    process.stderr.write = (chunk) => {
        stderr += chunk;
        return true;
    };

    fn();

    process.exit = origExit;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;

    return { stdout, stderr, exitCode };
}

test('logger output tests', async (t) => {
    await t.test('log writes default text', () => {
        const { stdout } = captureLoggerCall(() => {
            logger.log('Hello world');
        });
        assert.match(stdout, /Hello world/);
    });

    await t.test('log writes green text to stdout', () => {
        const { stdout } = captureLoggerCall(() => {
            logger.log('Hello green', 'green');
        });
        assert.match(stdout, /Hello green/);
        assert.match(stdout, /\x1b\[32m/);
    });

    await t.test('logWarn writes to stderr with yellow', () => {
        const { stderr } = captureLoggerCall(() => {
            logger.logWarn('Warning');
        });
        assert.match(stderr, /Warning/);
        assert.match(stderr, /\x1b\[33m/);
    });

    await t.test('logError writes to stderr with red', () => {
        const { stderr } = captureLoggerCall(() => {
            logger.logError('Error');
        });
        assert.match(stderr, /Error/);
        assert.match(stderr, /\x1b\[31m/);
    });

    await t.test('logFatal writes to stderr, exits with code 1', () => {
        const { stderr, exitCode } = captureLoggerCall(() => {
            logger.logFatal('Fatal');
        });
        assert.match(stderr, /Fatal/);
        assert.match(stderr, /FATAL/);
        assert.strictEqual(exitCode, 1);
    });

    await t.test('silent mode produces no output', () => {
        const { stdout, stderr } = captureLoggerCall(() => {
            logger.log('Silent', 'red', true);
        });
        assert.strictEqual(stdout, '');
        assert.strictEqual(stderr, '');
    });
});
