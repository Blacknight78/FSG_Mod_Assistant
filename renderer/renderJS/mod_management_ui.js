/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: MOD MANAGEMENT MENU UI

/* global MA */

window.addEventListener('DOMContentLoaded', () => {
	MA.byIdEventIfExists('menuUpdateCandidates', () => window.mod_management_IPC.dispatchUpdateCandidates())
	MA.byIdEventIfExists('menuVaultUpdates', () => window.mod_management_IPC.dispatchVaultUpdates())
	MA.byIdEventIfExists('menuManifest', () => window.mod_management_IPC.dispatchManifest())
	MA.byIdEventIfExists('menuVault', () => window.mod_management_IPC.dispatchVault())
	MA.byIdEventIfExists('menuBackups', () => window.mod_management_IPC.dispatchBackups())
	MA.byIdEventIfExists('menuRecentChanges', () => window.mod_management_IPC.dispatchRecentChanges())
	MA.byIdEventIfExists('menuHistory', () => window.mod_management_IPC.dispatchHistory())
})
