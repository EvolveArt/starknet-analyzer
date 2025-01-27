import { BigNumber } from "ethers";
import { defaultProvider, Provider } from "starknet";
import { BigNumberish } from "starknet/utils/number";

import { getFullSelectorFromName, getFullSelector } from "../helpers/helpers";

import {
	OrganizedEventAbi,
	OrganizedFunctionAbi,
	OrganizedStructAbi,
	StarknetArgument,
	OrganizedCalldata,
	OrganizedEvent,
	StarknetContractCode,
} from "../types/organizedStarknet";
import { Event, GetCodeResponse } from "../types/rawStarknet";
import { StandardProvider } from "../types";

export class ContractCallOrganizer {
	private _address: string;
	private _structs: OrganizedStructAbi | undefined;
	private _functions: OrganizedFunctionAbi | undefined;
	private _events: OrganizedEventAbi | undefined;
	private _provider: StandardProvider<Provider> | undefined;

	constructor(
		contractAddress: string,
		structs?: OrganizedStructAbi,
		functions?: OrganizedFunctionAbi,
		events?: OrganizedEventAbi,
		provider?: StandardProvider<Provider>
	) {
		this._address = contractAddress;
		this._structs = structs;
		this._functions = functions;
		this._events = events;
		this._provider = provider;
	}

	static async getContractAbi(
		contractAddress: string,
		provider: StandardProvider<Provider>
	) {
		let { functions, structs, events } = await this._organizeContractAbi(
			contractAddress,
			provider
		);

		const proxyEntryPoints = [
			"get_implementation",
			"getImplementation",
			"implementation",
		];
		const getImplementationSelectors = proxyEntryPoints.map((entrypoint) =>
			getFullSelectorFromName(entrypoint)
		);
		const getImplementationIndex = getImplementationSelectors.findIndex(
			(getImplementationSelector) => {
				return Object.keys(functions).includes(getImplementationSelector);
			}
		);
		if (getImplementationIndex !== -1) {
			const {
				result: [implementationAddress],
			} = await defaultProvider.callContract({
				contractAddress,
				entrypoint: proxyEntryPoints[getImplementationIndex],
			});
			try {
				const {
					functions: implementationFunctions,
					structs: implementationStructs,
					events: implementationEvents,
				} = await this._organizeContractAbi(
					implementationAddress,
					provider,
					true
				);

				functions = { ...functions, ...implementationFunctions };
				structs = { ...structs, ...implementationStructs };
				events = { ...events, ...implementationEvents };
			} catch (error) {
				console.error(error);
			}
		}

		return { functions, structs, events } as StarknetContractCode;
	}

	static async _organizeContractAbi(
		contractAddress: string,
		provider: StandardProvider<Provider>,
		isClassHash = false
	) {
		let _abi;
		if (!isClassHash) {
			const { abi } = (await provider.getCode(
				contractAddress
			)) as GetCodeResponse;
			_abi = abi;
		} else {
			const response = await fetch(
				`https://alpha4.starknet.io/feeder_gateway/get_class_by_hash?classHash=${contractAddress}`
			);
			const json = await response.json();
			_abi = json.abi;
		}
		if (Object.keys(_abi).length === 0) {
			throw new Error(
				`ContractCallOrganizer::_organizeContractAbi - Couldn't fetch abi for address ${contractAddress}`
			);
		}

		let functions: OrganizedFunctionAbi = {};
		let events: OrganizedEventAbi = {};
		let structs: OrganizedStructAbi = {};
		for (const item of _abi) {
			if (
				item.type === "function" ||
				item.type === "l1_handler" ||
				item.type === "constructor"
			) {
				const _name = getFullSelectorFromName(item.name);
				functions[_name] = item;
			}
			if (item.type === "struct") {
				structs[item.name] = {
					size: item.size,
					properties: item.members || [],
				};
			}
			if (item.type === "event") {
				const _name = getFullSelectorFromName(item.name);
				events[_name] = item;
			}
		}
		return { functions, structs, events } as StarknetContractCode;
	}

	async initialize(provider?: StandardProvider<Provider>) {
		const _provider = provider ? provider : this.provider;
		if (!_provider) {
			throw new Error(
				`ContractCallAnalyzer::initialize - No provider for this instance (provider: ${this.provider})`
			);
		}
		const { events, functions, structs } =
			await ContractCallOrganizer.getContractAbi(this.address, _provider);
		this._structs = structs;
		this._functions = functions;
		this._events = events;
		this._provider = _provider;
		return this;
	}

	async callViewFn(
		entrypoint: string,
		calldata?: BigNumberish[],
		provider?: StandardProvider<Provider>
	) {
		const _provider = provider ? provider : this.provider;
		if (!_provider) {
			throw new Error(
				`ContractCallAnalyzer::callViewFn - No provider for this instance (provider: ${this.provider})`
			);
		}
		const { result: rawRes } = await _provider.callContract({
			contractAddress: this.address,
			entrypoint,
			calldata: calldata || [],
		});

		const rawResBN = rawRes.map((rawPool: any) => BigNumber.from(rawPool));

		const { subcalldata } = this.organizeFunctionOutput(
			getFullSelectorFromName(entrypoint),
			rawResBN
		) as any;

		return subcalldata;
	}

	organizeFunctionInput(
		functionSelector: string,
		fullCalldataValues: BigNumber[],
		startIndex?: number
	) {
		const inputs = this.getFunctionAbiFromSelector(functionSelector).inputs;
		let calldataIndex = startIndex || 0;

		let calldata: OrganizedCalldata = [];
		for (const input of inputs) {
			const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(
				input.type,
				{ fullCalldataValues: fullCalldataValues, startIndex: calldataIndex }
			);
			calldataIndex = endIndex;
			calldata.push({ ...input, value: argsValues });
		}

		return { subcalldata: calldata, endIndex: calldataIndex };
	}

	organizeFunctionOutput(
		functionSelector: string,
		fullCalldataValues: BigNumber[],
		startIndex?: number
	) {
		const outputs = this.getFunctionAbiFromSelector(functionSelector).outputs;
		let calldataIndex = startIndex || 0;

		let calldata: OrganizedCalldata = [];
		for (const output of outputs) {
			const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(
				output.type,
				{ fullCalldataValues: fullCalldataValues, startIndex: calldataIndex }
			);
			calldataIndex = endIndex;
			calldata.push({ ...output, value: argsValues });
		}

		return { subcalldata: calldata, endIndex: calldataIndex };
	}

	organizeEvent(event: Event) {
		// TODO: make another for loop for each keys in case many events are triggered
		// (never saw this case yet after analysing hundreds of blocks)
		// RE: Found one at txHash 0x2a709a4b385ee4ff07303636c3fe71964853cdaed824421475d639ab9b4eb9d but idk how to interpret it yet
		if (event.keys.length > 1) {
			throw new Error(
				`ContractAnalyzer::structureEvent - You forwarded an event with many keys. This is a reminder this need to be added.`
			);
		}

		const eventAbi = this.getEventAbiFromKey(getFullSelector(event.keys[0]));

		let dataIndex = 0;
		let eventArgs = [];
		for (const arg of eventAbi.data) {
			const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(
				arg.type,
				{ fullCalldataValues: event.data, startIndex: dataIndex }
			);
			dataIndex = endIndex;
			eventArgs.push({ ...arg, value: argsValues });
		}
		return {
			name: eventAbi.name,
			transmitterContract: event.from_address,
			calldata: eventArgs,
		} as OrganizedEvent;
	}

	_getArgumentsValuesFromCalldata(
		type: string,
		calldata: { fullCalldataValues: BigNumber[]; startIndex: number }
	) {
		const rawType = type.includes("*") ? type.slice(0, type.length - 1) : type;
		if (type === "felt") {
			const { felt, endIndex } = this._getFeltFromCalldata(
				calldata.fullCalldataValues,
				calldata.startIndex
			);
			return { argsValues: felt, endIndex };
		} else if (type === "felt*") {
			const size = this._getArraySizeFromCalldata(calldata);
			const { feltArray, endIndex } = this._getFeltArrayFromCalldata(
				calldata.fullCalldataValues,
				calldata.startIndex,
				size
			);
			return { argsValues: feltArray, endIndex };
		} else if (!type.includes("*") && type !== "felt") {
			const { structCalldata, endIndex } = this._getStructFromCalldata(
				rawType,
				calldata.fullCalldataValues,
				calldata.startIndex
			);
			return { argsValues: structCalldata, endIndex };
		} else {
			const size = this._getArraySizeFromCalldata(calldata);
			const { structArray, endIndex } = this._getStructArrayFromCalldata(
				rawType,
				calldata.fullCalldataValues,
				calldata.startIndex,
				size
			);
			return { argsValues: structArray, endIndex };
		}
	}

	_getArraySizeFromCalldata(calldata: {
		fullCalldataValues: BigNumber[];
		startIndex: number;
	}) {
		try {
			const size = BigNumber.from(
				calldata.fullCalldataValues[calldata.startIndex - 1].toString()
			).toNumber();
			return size;
		} catch (error) {
			console.log("ContractAnalysze::getArraySizeFromCalldata - error", error);
			throw new Error(
				`ContractAnalysze::getArraySizeFromCalldata - Error trying to get the previous calldata index and converting it into number (value: ${
					calldata.fullCalldataValues[calldata.startIndex - 1]
				})`
			);
		}
	}

	_getFeltFromCalldata(calldata: BigNumber[], startIndex: number) {
		const felt = calldata[startIndex];
		return { felt, endIndex: startIndex + 1 };
	}

	_getFeltArrayFromCalldata(
		calldata: BigNumber[],
		startIndex: number,
		sizeOfArray: number
	) {
		let feltArray = [];
		let calldataIndex = startIndex;
		for (let j = startIndex; j < startIndex + sizeOfArray; j++) {
			feltArray.push(calldata[j]);
			calldataIndex++;
		}

		return { feltArray, endIndex: calldataIndex };
	}

	_getStructFromCalldata(
		type: string,
		calldata: BigNumber[],
		startIndex: number
	) {
		const structAbi = this.getStructAbiFromStructType(type);
		let structCalldata: StarknetArgument = {};
		let calldataIndex = startIndex;
		for (const property of structAbi.properties) {
			const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(
				property.type,
				{ fullCalldataValues: calldata, startIndex: calldataIndex }
			);
			structCalldata[property.name] = argsValues;
			calldataIndex = endIndex;
		}

		return { structCalldata, endIndex: calldataIndex };
	}

	_getStructArrayFromCalldata(
		type: string,
		calldata: BigNumber[],
		startIndex: number,
		size: number
	) {
		const structAbi = this.getStructAbiFromStructType(type);
		let structArray = [];
		let calldataIndex = startIndex;
		for (let j = 0; j < size; j++) {
			let singleStruct: StarknetArgument = {};

			for (const property of structAbi.properties!) {
				const { argsValues, endIndex } = this._getArgumentsValuesFromCalldata(
					property.type,
					{ fullCalldataValues: calldata, startIndex: calldataIndex }
				);
				singleStruct[property.name] = argsValues;
				calldataIndex = endIndex;
			}
			structArray.push(singleStruct);
		}

		return { structArray, endIndex: calldataIndex };
	}

	getFunctionAbiFromSelector(_functionSelector: string) {
		const functionSelector = getFullSelector(_functionSelector);
		if (!this.functions) {
			throw new Error(
				`ContractAnalyzer::getFunctionFromSelector - On contract ${this.address} no functions declared for this ContractAnalyzer instance (functions: ${this.functions})`
			);
		}

		const fn = this.functions[functionSelector];

		if (!fn) {
			throw new Error(
				`ContractAnalyzer::getFunctionFromSelector - On contract ${this.address} no functions matching this selector (selector: ${functionSelector})`
			);
		}

		return fn;
	}

	getStructAbiFromStructType(type: string) {
		if (!this.structs) {
			throw new Error(
				`ContractAnalyzer::getStructFromStructs - On contract ${this.address} no struct specified for this instance (structs: ${this.structs})`
			);
		}

		const struct = this.structs[type];

		if (!struct) {
			throw new Error(
				`ContractAnalyzer::getStructFromStructs - On contract ${this.address} no struct specified for this type (structType: ${type})`
			);
		}
		return struct;
	}

	getEventAbiFromKey(key: string) {
		if (!this.events) {
			throw new Error(
				`ContractAnalyzer::getEventFromKey - On contract ${this.address} no events specified for this instance (events: ${this.events})`
			);
		}

		const event = this.events[key];

		if (!event) {
			throw new Error(
				`ContractAnalyzer::getEventFromKey - On contract ${this.address}, no events specified for this key (key: ${key})`
			);
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
