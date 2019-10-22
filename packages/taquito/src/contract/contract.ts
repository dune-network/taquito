import { Schema, ParameterSchema } from '@taquito/michelson-encoder';
import { ContractProvider } from './interface';
import { ScriptResponse } from '@taquito/rpc';

interface SendParams {
  fee?: number;
  storageLimit?: number;
  gasLimit?: number;
  amount?: number;
}

/**
 * @description Utility class to send smart contract operation
 */
export class ContractMethod {
  constructor(
    private provider: ContractProvider,
    private address: string,
    private parameterSchema: ParameterSchema,
    private name: string,
    private args: any[],
    private isMultipleEntrypoint = true
  ) {}

  /**
   * @description Get the schema of the smart contract method
   */
  get schema() {
    return this.parameterSchema.ExtractSchema();
  }

  /**
   *
   * @description Send the smart contract operation
   *
   * @param Options generic operation parameter
   */
  send({ fee, gasLimit, storageLimit, amount = 0 }: Partial<SendParams> = {}) {
    return this.provider.transfer({
      to: this.address,
      amount,
      fee,
      gasLimit,
      storageLimit,
      parameter: {
        entrypoint: this.isMultipleEntrypoint ? this.name : 'default',
        value: this.parameterSchema.Encode(...this.args),
      } as any,
      rawParam: true,
    });
  }
}

/**
 * @description Utility class to send smart contract operation
 */
export class LegacyContractMethod {
  constructor(
    private provider: ContractProvider,
    private address: string,
    private parameterSchema: ParameterSchema,
    private name: string,
    private args: any[]
  ) {}

  /**
   * @description Get the schema of the smart contract method
   */
  get schema() {
    return this.parameterSchema.isMultipleEntryPoint
      ? this.parameterSchema.ExtractSchema()[this.name]
      : this.parameterSchema.ExtractSchema();
  }

  /**
   *
   * @description Send the smart contract operation
   *
   * @param Options generic operation parameter
   */
  send({ fee, gasLimit, storageLimit, amount = 0 }: Partial<SendParams> = {}) {
    return this.provider.transfer({
      to: this.address,
      amount,
      fee,
      gasLimit,
      storageLimit,
      parameter: this.parameterSchema.isMultipleEntryPoint
        ? this.parameterSchema.Encode(this.name, ...this.args)
        : this.parameterSchema.Encode(...this.args),
      rawParam: true,
    });
  }
}

function computeLength(data: string | Object) {
  if (typeof data === 'object') {
    return Object.keys(data).length;
  } else {
    return 1;
  }
}
/**
 * @description Smart contract abstraction
 */
export class Contract {
  /**
   * @description Contains methods that are implemented by the target Tezos Smart Contract, and offers the user to call the Smart Contract methods as if they were native TS/JS methods.
   * NB: if the contract contains annotation it will include named properties; if not it will be indexed by a number.
   *
   */
  public methods: { [key: string]: (...args: any[]) => ContractMethod | LegacyContractMethod } = {};

  public readonly schema: Schema;

  public readonly parameterSchema: ParameterSchema;

  constructor(
    public readonly address: string,
    public readonly script: ScriptResponse,
    private provider: ContractProvider,
    private entrypoints?: { entrypoints: { [key: string]: object } }
  ) {
    this.schema = Schema.fromRPCResponse({ script: this.script });
    this.parameterSchema = ParameterSchema.fromRPCResponse({ script: this.script });
    if (!this.entrypoints) {
      this._initializeMethodsLegacy(address, provider);
    } else {
      this._initializeMethods(address, provider, this.entrypoints.entrypoints);
    }
  }

  private _initializeMethods(
    address: string,
    provider: ContractProvider,
    entrypoints: { [key: string]: any }
  ) {
    const keys = Object.keys(entrypoints);
    if (keys.length > 0) {
      keys.forEach(smartContractMethodName => {
        const method = function(...args: any[]) {
          const smartContractMethodSchema = new ParameterSchema(
            entrypoints[smartContractMethodName]
          );
          if (args.length !== computeLength(smartContractMethodSchema.ExtractSchema())) {
            throw new Error(
              `${smartContractMethodName} Received ${
                args.length
              } arguments while expecting ${computeLength(
                smartContractMethodSchema.ExtractSchema()
              )} (${JSON.stringify(Object.keys(smartContractMethodSchema.ExtractSchema()))})`
            );
          }
          return new ContractMethod(
            provider,
            address,
            smartContractMethodSchema,
            smartContractMethodName,
            args
          );
        };
        this.methods[smartContractMethodName] = method;
      });
    } else {
      const smartContractMethodSchema = this.parameterSchema;
      const method = function(...args: any[]) {
        if (args.length !== computeLength(smartContractMethodSchema.ExtractSchema())) {
          throw new Error(
            `main Received ${args.length} arguments while expecting ${computeLength(
              smartContractMethodSchema.ExtractSchema()
            )} (${JSON.stringify(Object.keys(smartContractMethodSchema.ExtractSchema()))})`
          );
        }
        return new ContractMethod(
          provider,
          address,
          smartContractMethodSchema,
          'main',
          args,
          false
        );
      };
      this.methods['main'] = method;
    }
  }

  private _initializeMethodsLegacy(address: string, provider: ContractProvider) {
    const parameterSchema = this.parameterSchema;
    const paramSchema = this.parameterSchema.ExtractSchema();

    if (this.parameterSchema.isMultipleEntryPoint) {
      Object.keys(paramSchema).forEach(smartContractMethodName => {
        const method = function(...args: any[]) {
          const smartContractMethodSchema = paramSchema[smartContractMethodName];
          if (args.length !== computeLength(smartContractMethodSchema)) {
            throw new Error(
              `${smartContractMethodName} Received ${
                args.length
              } arguments while expecting ${computeLength(
                smartContractMethodSchema
              )} (${JSON.stringify(Object.keys(smartContractMethodSchema))})`
            );
          }
          return new LegacyContractMethod(
            provider,
            address,
            parameterSchema,
            smartContractMethodName,
            args
          );
        };
        this.methods[smartContractMethodName] = method;
      });
    } else {
      this.methods['main'] = function(...args: any[]) {
        const smartContractMethodSchema = paramSchema;
        if (args.length !== computeLength(smartContractMethodSchema)) {
          throw new Error(
            `Received ${args.length} arguments while expecting ${computeLength(
              smartContractMethodSchema
            )} (${JSON.stringify(Object.keys(smartContractMethodSchema))})`
          );
        }
        return new LegacyContractMethod(provider, address, parameterSchema, 'main', args);
      };
    }
  }

  /**
   * @description Return a friendly representation of the smart contract storage
   */
  public storage<T>() {
    return this.provider.getStorage<T>(this.address, this.schema);
  }

  /**
   *
   * @description Return a friendly representation of the smart contract big map value
   *
   * @param key BigMap key to fetch
   */
  public bigMap(key: string) {
    return this.provider.getBigMapKey(this.address, key, this.schema);
  }
}
