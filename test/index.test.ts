import assert from "assert";
import { ContractCallOrganizer } from "../src/organizers/ContractCallOrganizer";
import { Provider } from "starknet";
import { GetCodeResponse } from "../src/types/rawStarknet";

describe("ContractCallOrganizer", function () {
	it("Fecth ABI", async function () {
		const _provider = new Provider({ sequencer: { network: "goerli-alpha" } });
		// const contractCallOrganizer = await new ContractCallOrganizer(
		// 	"0x041c4e86a03480313547a04e13fc4d43d7fb7bcb5244fd0cb93f793f304f6124"
		// ).initialize(_provider);
		const response = await _provider.getClassAt(
			"0x41c4e86a03480313547a04e13fc4d43d7fb7bcb5244fd0cb93f793f304f6124"
		);
		console.log(response);

		// console.log(contractCallOrganizer.abi);
	});
});
