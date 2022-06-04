import { BigNumber } from "ethers";
import { Provider } from "starknet";
import { OrganizedEventAbi, OrganizedFunctionAbi, OrganizedStructAbi, StarknetArgument, OrganizedEvent, StarknetContractCode } from "../types/organizedStarknet";
import { Event } from "../types/rawStarknet";
import { StandardProvider } from "../types";
export declare class ContractCallOrganizer {
    private _address;
    private _structs;
    private _functions;
    private _events;
    private _provider;
    constructor(contractAddress: string, structs?: OrganizedStructAbi, functions?: OrganizedFunctionAbi, events?: OrganizedEventAbi, provider?: StandardProvider<Provider>);
    static getContractAbi(contractAddress: string, provider: StandardProvider<Provider>): Promise<StarknetContractCode>;
    static _organizeContractAbi(contractAddress: string, provider: StandardProvider<Provider>): Promise<StarknetContractCode>;
    initialize(provider?: StandardProvider<Provider>): Promise<this>;
    callViewFn(entrypoint: string, calldata?: BigNumber[], provider?: StandardProvider<Provider>): Promise<any>;
    organizeFunctionInput(functionSelector: string, fullCalldataValues: BigNumber[], startIndex?: number): {
        subcalldata: {
            [key: string]: any;
        } | StarknetArgument[];
        endIndex: number;
    };
    organizeFunctionOutput(functionSelector: string, fullCalldataValues: BigNumber[], startIndex?: number): {
        subcalldata: {
            [key: string]: any;
        } | StarknetArgument[];
        endIndex: number;
    };
    organizeEvent(event: Event): OrganizedEvent;
    _getArgumentsValuesFromCalldata(type: string, calldata: {
        fullCalldataValues: BigNumber[];
        startIndex: number;
    }): {
        argsValues: {
            [key: string]: any;
        };
        endIndex: number;
    };
    _getArraySizeFromCalldata(calldata: {
        fullCalldataValues: BigNumber[];
        startIndex: number;
    }): number;
    _getFeltFromCalldata(calldata: BigNumber[], startIndex: number): {
        felt: BigNumber;
        endIndex: number;
    };
    _getFeltArrayFromCalldata(calldata: BigNumber[], startIndex: number, sizeOfArray: number): {
        feltArray: BigNumber[];
        endIndex: number;
    };
    _getStructFromCalldata(type: string, calldata: BigNumber[], startIndex: number): {
        structCalldata: {
            [key: string]: any;
        };
        endIndex: number;
    };
    _getStructArrayFromCalldata(type: string, calldata: BigNumber[], startIndex: number, size: number): {
        structArray: {
            [key: string]: any;
        }[];
        endIndex: number;
    };
    getFunctionAbiFromSelector(functionSelector: string): import("../types/rawStarknet").FunctionAbi;
    getStructAbiFromStructType(type: string): import("../types/organizedStarknet").StarknetStruct;
    getEventAbiFromKey(key: string): import("../types/rawStarknet").EventAbi;
    get address(): string;
    get structs(): OrganizedStructAbi | undefined;
    get functions(): OrganizedFunctionAbi | undefined;
    get events(): OrganizedEventAbi | undefined;
    get abi(): {
        functions: OrganizedFunctionAbi | undefined;
        events: OrganizedEventAbi | undefined;
        structs: OrganizedStructAbi | undefined;
    };
    get provider(): StandardProvider<Provider> | undefined;
}
//# sourceMappingURL=ContractCallOrganizer.d.ts.map