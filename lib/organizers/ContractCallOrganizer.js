"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractCallOrganizer = void 0;
const ethers_1 = require("ethers");
const starknet_1 = require("starknet");
const helpers_1 = require("../helpers/helpers");
class ContractCallOrganizer {
    constructor(contractAddress, structs, functions, events, provider) {
        this._address = contractAddress;
        this._structs = structs;
        this._functions = functions;
        this._events = events;
        this._provider = provider;
    }
    static getContractAbi(contractAddress, provider) {
        return __awaiter(this, void 0, void 0, function* () {
            let { functions, structs, events } = yield this._organizeContractAbi(contractAddress, provider);
            const proxyEntryPoints = [
                "get_implementation",
                "getImplementation",
                "implementation",
            ];
            const getImplementationSelectors = proxyEntryPoints.map((entrypoint) => (0, helpers_1.getFullSelectorFromName)(entrypoint));
            const getImplementationIndex = getImplementationSelectors.findIndex((getImplementationSelector) => {
                return Object.keys(functions).includes(getImplementationSelector);
            });
            if (getImplementationIndex !== -1) {
                const { result: [implementationAddress], } = yield starknet_1.defaultProvider.callContract({
                    contractAddress,
                    entrypoint: proxyEntryPoints[getImplementationIndex],
                });
                try {
                    const { functions: implementationFunctions, structs: implementationStructs, events: implementationEvents, } = yield this._organizeContractAbi(implementationAddress, provider, true);
                    functions = Object.assign(Object.assign({}, functions), implementationFunctions);
                    structs = Object.assign(Object.assign({}, structs), implementationStructs);
                    events = Object.assign(Object.assign({}, events), implementationEvents);
                }
                catch (error) {
                    console.error(error);
                }
            }
            return { functions, structs, events };
        });
    }
    static _organizeContractAbi(contractAddress, provider, isClassHash = false) {
        return __awaiter(this, void 0, void 0, function* () {
            let _abi;
            if (!isClassHash) {
                const { abi } = (yield provider.getCode(contractAddress));
                _abi = abi;
            }
            else {
                const response = yield fetch(`https://alpha4.starknet.io/feeder_gateway/get_class_by_hash?classHash=${contractAddress}`);
                const json = yield response.json();
                _abi = json.abi;
            }
            if (Object.keys(_abi).length === 0) {
                throw new Error(`ContractCallOrganizer::_organizeContractAbi - Couldn't fetch abi for address ${contractAddress}`);
            }
            let functions = {};
            let events = {};
            let structs = {};
            for (const item of _abi) {
                if (item.type === "function" ||
                    item.type === "l1_handler" ||
                    item.type === "constructor") {
                    const _name = (0, helpers_1.getFullSelectorFromName)(item.name);
                    functions[_name] = item;
                }
                if (item.type === "struct") {
                    structs[item.name] = {
                        size: item.size,
                        properties: item.members || [],
                    };
                }
                if (item.type === "event") {
                    const _name = (0, helpers_1.getFullSelectorFromName)(item.name);
                    events[_name] = item;
                }
            }
            return { functions, structs, events };
        });
    }
    initialize(provider) {
        return __awaiter(this, void 0, void 0, function* () {
            const _provider = provider ? provider : this.provider;
            if (!_provider) {
                throw new Error(`ContractCallAnalyzer::initialize - No provider for this instance (provider: ${this.provider})`);
            }
            const { events, functions, structs } = yield ContractCallOrganizer.getContractAbi(this.address, _provider);
            this._structs = structs;
            this._functions = functions;
            this._events = events;
            this._provider = _provider;
            return this;
        });
    }
    callViewFn(entrypoint, calldata, provider) {
        return __awaiter(this, void 0, void 0, function* () {
            const _provider = provider ? provider : this.provider;
            if (!_provider) {
                throw new Error(`ContractCallAnalyzer::callViewFn - No provider for this instance (provider: ${this.provider})`);
            }
            const { result: rawRes } = yield _provider.callContract({
                contractAddress: this.address,
                entrypoint,
                calldata: calldata || [],
            });
            const rawResBN = rawRes.map((rawPool) => ethers_1.BigNumber.from(rawPool));
            const { subcalldata } = this.organizeFunctionOutput((0, helpers_1.getFullSelectorFromName)(entrypoint), rawResBN);
            return subcalldata;
        });
    }
    organizeFunctionInput(functionSelector, fullCalldataValues, startIndex) {
        const inputs = this.getFunctionAbiFromSelector(functionSelector).inputs;
        let calldataIndex = startIndex || 0;
        let calldata = [];
        for (const input of inputs) {
            const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(input.type, { fullCalldataValues: fullCalldataValues, startIndex: calldataIndex });
            calldataIndex = endIndex;
            calldata.push(Object.assign(Object.assign({}, input), { value: argsValues }));
        }
        return { subcalldata: calldata, endIndex: calldataIndex };
    }
    organizeFunctionOutput(functionSelector, fullCalldataValues, startIndex) {
        const outputs = this.getFunctionAbiFromSelector(functionSelector).outputs;
        let calldataIndex = startIndex || 0;
        let calldata = [];
        for (const output of outputs) {
            const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(output.type, { fullCalldataValues: fullCalldataValues, startIndex: calldataIndex });
            calldataIndex = endIndex;
            calldata.push(Object.assign(Object.assign({}, output), { value: argsValues }));
        }
        return { subcalldata: calldata, endIndex: calldataIndex };
    }
    organizeEvent(event) {
        // TODO: make another for loop for each keys in case many events are triggered
        // (never saw this case yet after analysing hundreds of blocks)
        // RE: Found one at txHash 0x2a709a4b385ee4ff07303636c3fe71964853cdaed824421475d639ab9b4eb9d but idk how to interpret it yet
        if (event.keys.length > 1) {
            throw new Error(`ContractAnalyzer::structureEvent - You forwarded an event with many keys. This is a reminder this need to be added.`);
        }
        const eventAbi = this.getEventAbiFromKey((0, helpers_1.getFullSelector)(event.keys[0]));
        let dataIndex = 0;
        let eventArgs = [];
        for (const arg of eventAbi.data) {
            const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(arg.type, { fullCalldataValues: event.data, startIndex: dataIndex });
            dataIndex = endIndex;
            eventArgs.push(Object.assign(Object.assign({}, arg), { value: argsValues }));
        }
        return {
            name: eventAbi.name,
            transmitterContract: event.from_address,
            calldata: eventArgs,
        };
    }
    _getArgumentsValuesFromCalldata(type, calldata) {
        const rawType = type.includes("*") ? type.slice(0, type.length - 1) : type;
        if (type === "felt") {
            const { felt, endIndex } = this._getFeltFromCalldata(calldata.fullCalldataValues, calldata.startIndex);
            return { argsValues: felt, endIndex };
        }
        else if (type === "felt*") {
            const size = this._getArraySizeFromCalldata(calldata);
            const { feltArray, endIndex } = this._getFeltArrayFromCalldata(calldata.fullCalldataValues, calldata.startIndex, size);
            return { argsValues: feltArray, endIndex };
        }
        else if (!type.includes("*") && type !== "felt") {
            const { structCalldata, endIndex } = this._getStructFromCalldata(rawType, calldata.fullCalldataValues, calldata.startIndex);
            return { argsValues: structCalldata, endIndex };
        }
        else {
            const size = this._getArraySizeFromCalldata(calldata);
            const { structArray, endIndex } = this._getStructArrayFromCalldata(rawType, calldata.fullCalldataValues, calldata.startIndex, size);
            return { argsValues: structArray, endIndex };
        }
    }
    _getArraySizeFromCalldata(calldata) {
        try {
            const size = ethers_1.BigNumber.from(calldata.fullCalldataValues[calldata.startIndex - 1].toString()).toNumber();
            return size;
        }
        catch (error) {
            console.log("ContractAnalysze::getArraySizeFromCalldata - error", error);
            throw new Error(`ContractAnalysze::getArraySizeFromCalldata - Error trying to get the previous calldata index and converting it into number (value: ${calldata.fullCalldataValues[calldata.startIndex - 1]})`);
        }
    }
    _getFeltFromCalldata(calldata, startIndex) {
        const felt = calldata[startIndex];
        return { felt, endIndex: startIndex + 1 };
    }
    _getFeltArrayFromCalldata(calldata, startIndex, sizeOfArray) {
        let feltArray = [];
        let calldataIndex = startIndex;
        for (let j = startIndex; j < startIndex + sizeOfArray; j++) {
            feltArray.push(calldata[j]);
            calldataIndex++;
        }
        return { feltArray, endIndex: calldataIndex };
    }
    _getStructFromCalldata(type, calldata, startIndex) {
        const structAbi = this.getStructAbiFromStructType(type);
        let structCalldata = {};
        let calldataIndex = startIndex;
        for (const property of structAbi.properties) {
            const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(property.type, { fullCalldataValues: calldata, startIndex: calldataIndex });
            structCalldata[property.name] = argsValues;
            calldataIndex = endIndex;
        }
        return { structCalldata, endIndex: calldataIndex };
    }
    _getStructArrayFromCalldata(type, calldata, startIndex, size) {
        const structAbi = this.getStructAbiFromStructType(type);
        let structArray = [];
        let calldataIndex = startIndex;
        for (let j = 0; j < size; j++) {
            let singleStruct = {};
            for (const property of structAbi.properties) {
                const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(property.type, { fullCalldataValues: calldata, startIndex: calldataIndex });
                singleStruct[property.name] = argsValues;
                calldataIndex = endIndex;
            }
            structArray.push(singleStruct);
        }
        return { structArray, endIndex: calldataIndex };
    }
    getFunctionAbiFromSelector(_functionSelector) {
        const functionSelector = (0, helpers_1.getFullSelector)(_functionSelector);
        if (!this.functions) {
            throw new Error(`ContractAnalyzer::getFunctionFromSelector - On contract ${this.address} no functions declared for this ContractAnalyzer instance (functions: ${this.functions})`);
        }
        const fn = this.functions[functionSelector];
        if (!fn) {
            throw new Error(`ContractAnalyzer::getFunctionFromSelector - On contract ${this.address} no functions matching this selector (selector: ${functionSelector})`);
        }
        return fn;
    }
    getStructAbiFromStructType(type) {
        if (!this.structs) {
            throw new Error(`ContractAnalyzer::getStructFromStructs - On contract ${this.address} no struct specified for this instance (structs: ${this.structs})`);
        }
        const struct = this.structs[type];
        if (!struct) {
            throw new Error(`ContractAnalyzer::getStructFromStructs - On contract ${this.address} no struct specified for this type (structType: ${type})`);
        }
        return struct;
    }
    getEventAbiFromKey(key) {
        if (!this.events) {
            throw new Error(`ContractAnalyzer::getEventFromKey - On contract ${this.address} no events specified for this instance (events: ${this.events})`);
        }
        const event = this.events[key];
        if (!event) {
            throw new Error(`ContractAnalyzer::getEventFromKey - On contract ${this.address}, no events specified for this key (key: ${key})`);
        }
        return event;
    }
    get address() {
        return this._address;
    }
    get structs() {
        return this._structs;
    }
    get functions() {
        return this._functions;
    }
    get events() {
        return this._events;
    }
    get abi() {
        return {
            functions: this.functions,
            events: this.events,
            structs: this.structs,
        };
    }
    get provider() {
        return this._provider;
    }
}
exports.ContractCallOrganizer = ContractCallOrganizer;
//# sourceMappingURL=ContractCallOrganizer.js.map