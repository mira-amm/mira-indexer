// import assert from "assert";
// import {
//   Mira_MintEvent_eventArgs,
//   TestHelpers,
// } from "generated";
// const { MockDb, Mira } = TestHelpers;
// TODO tests
// describe("Mira contract MintEvent event tests", () => {
//   // Create mock db
//   const mockDb = MockDb.createMockDb();
//
//   // Creating mock for Mira contract MintEvent event
//   const event = Mira.MintEvent.mock({data: {} /* It mocks event fields with default values, so you only need to provide data */});
//
//   it("Pool is created correctly", async () => {
//     // Processing the event
//     const mockDbUpdated = await Mira.MintEvent.processEvent({
//       event,
//       mockDb,
//     });
//
//     // Getting the actual entity from the mock database
//     let actualMiraMintEvent = mockDbUpdated.entities.Mira_MintEvent.get(
//       `${event.transactionId}_${event.receiptIndex}`
//     );
//
//     // Creating the expected entity
//     const expectedMiraMintEvent: Mira_MintEvent_eventArgs = {
//       id: `${event.transactionId}_${event.receiptIndex}`,
//     };
//     // Asserting that the entity in the mock database is the same as the expected entity
//     assert.deepEqual(actualMiraMintEvent, expectedMiraMintEvent, "Actual MiraMintEvent should be the same as the expectedMiraMintEvent");
//   });
// });
