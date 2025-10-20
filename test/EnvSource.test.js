const EnvSource = require('../src/sources/EnvSource');

describe('EnvSource', () => {
    let envSource;
    
    beforeEach(() => {
        envSource = new EnvSource();
    });
    
    afterEach(async () => {
        await envSource.cleanup();
    });

    test('should initialize without error', async () => {
        await expect(envSource.initialize()).resolves.toBeUndefined();
    });

    test('should resolve existing environment variable', async () => {
        process.env.TEST_ENV_VAR = 'test_value';
        
        await envSource.initialize();
        const result = await envSource.resolve('TEST_ENV_VAR');
        
        expect(result).toBe('test_value');
        
        delete process.env.TEST_ENV_VAR;
    });

    test('should throw error for non-existing environment variable', async () => {
        await envSource.initialize();
        
        await expect(envSource.resolve('NONEXISTENT_VAR')).rejects.toThrow();
    });

    test('should handle prefix configuration', async () => {
        const configuredSource = new EnvSource({ prefix: 'APP_' });
        process.env.APP_CONFIG = 'app_value';
        
        await configuredSource.initialize();
        const result = await configuredSource.resolve('CONFIG');
        
        expect(result).toBe('app_value');
        
        delete process.env.APP_CONFIG;
    });

    test('should handle case transformation', async () => {
        const configuredSource = new EnvSource({ transformCase: 'upper' });
        process.env.UPPER_VAR = 'upper_value';
        
        await configuredSource.initialize();
        const result = await configuredSource.resolve('upper_var');
        
        expect(result).toBe('upper_value');
        
        delete process.env.UPPER_VAR;
    });

    test('should check if environment variable exists', () => {
        process.env.EXISTS_VAR = 'exists';
        
        expect(envSource.exists('EXISTS_VAR')).toBe(true);
        expect(envSource.exists('DOES_NOT_EXIST')).toBe(false);
        
        delete process.env.EXISTS_VAR;
    });

    test('should list available environment variables', () => {
        process.env.TEST_LIST_1 = 'value1';
        process.env.TEST_LIST_2 = 'value2';
        
        const configuredSource = new EnvSource({ prefix: 'TEST_LIST_' });
        const available = configuredSource.listAvailable();
        
        expect(available).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: '1', hasValue: true }),
                expect.objectContaining({ key: '2', hasValue: true })
            ])
        );
        
        delete process.env.TEST_LIST_1;
        delete process.env.TEST_LIST_2;
    });
});