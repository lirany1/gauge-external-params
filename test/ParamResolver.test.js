const ParamResolver = require('../src/resolver/ParamResolver');
const EnvSource = require('../src/sources/EnvSource');
const FileSource = require('../src/sources/FileSource');
const path = require('path');

describe('ParamResolver', () => {
    let resolver;
    
    beforeEach(() => {
        resolver = new ParamResolver();
    });
    
    afterEach(async () => {
        if (resolver) {
            await resolver.cleanup();
        }
    });

    describe('Placeholder Parsing', () => {
        test('should parse simple placeholder', () => {
            const parsed = ParamResolver.parsePlaceholder('<user:env#USERNAME>');
            expect(parsed).toEqual({
                name: 'user',
                source: 'env',
                key: 'USERNAME',
                defaultValue: undefined
            });
        });

        test('should parse placeholder with default value', () => {
            const parsed = ParamResolver.parsePlaceholder('<user:env#USERNAME|admin>');
            expect(parsed).toEqual({
                name: 'user',
                source: 'env',
                key: 'USERNAME',
                defaultValue: 'admin'
            });
        });

        test('should create placeholder text', () => {
            const placeholder = ParamResolver.createPlaceholder('user', 'env', 'USERNAME', 'admin');
            expect(placeholder).toBe('<user:env#USERNAME|admin>');
        });

        test('should create placeholder without default', () => {
            const placeholder = ParamResolver.createPlaceholder('user', 'env', 'USERNAME');
            expect(placeholder).toBe('<user:env#USERNAME>');
        });
    });

    describe('Text Resolution', () => {
        test('should resolve text with environment variables', async () => {
            process.env.TEST_VAR = 'test_value';
            
            const configPath = path.join(__dirname, 'fixtures', 'test-config.json');
            resolver = new ParamResolver(configPath);
            await resolver.initialize();
            
            const text = 'Hello <user:env#TEST_VAR>!';
            const resolved = await resolver.resolveText(text);
            
            expect(resolved).toBe('Hello test_value!');
            
            delete process.env.TEST_VAR;
        });

        test('should use default value when variable not found', async () => {
            const configPath = path.join(__dirname, 'fixtures', 'test-config.json');
            resolver = new ParamResolver(configPath);
            await resolver.initialize();
            
            const text = 'Hello <user:env#NONEXISTENT_VAR|default_user>!';
            const resolved = await resolver.resolveText(text);
            
            expect(resolved).toBe('Hello default_user!');
        });

        test('should resolve multiple placeholders', async () => {
            process.env.USER = 'testuser';
            process.env.HOST = 'localhost';
            
            const configPath = path.join(__dirname, 'fixtures', 'test-config.json');
            resolver = new ParamResolver(configPath);
            await resolver.initialize();
            
            const text = 'Connect <user:env#USER> to <host:env#HOST>';
            const resolved = await resolver.resolveText(text);
            
            expect(resolved).toBe('Connect testuser to localhost');
            
            delete process.env.USER;
            delete process.env.HOST;
        });
    });
});