	// if the popup is opened and closed within this time, switch to the
	// previous tab
const MaxPopupLifetime = 450,
	WindowActivatedDelay = 500,
	MinTabDwellTime = 750,
	RestartDelay = 10 * 1000,
	TrackerID = "UA-108153491-3";


var gStartingUp = false;


function debounce(
	func,
	wait)
{
	var timeout;

	return function() {
		var context = this,
			args = arguments;

		clearTimeout(timeout);
		timeout = setTimeout(function() {
			timeout = null;
			func.apply(context, args);
		}, wait);
	};
}


chrome.runtime.onStartup.addListener(function() {
	var timer = null;

	gStartingUp = true;

console.log("== onStartup");

	function onLastActivated()
	{
		chrome.tabs.onActivated.removeListener(onActivated);

console.log("==== last onActivated");

		require([
			"background/recent-tabs"
		], function(
			recentTabs
		) {
// TODO: move this into a global function set inside the main require()
				// the stored recent tab data will be out of date, since the tabs
				// will get new IDs when the app reloads each one
			return recentTabs.updateAll()
				.then(function() {
console.log("===== updateAll done");

					gStartingUp = false;
				});
		});
	}


	function onActivated()
	{
		clearTimeout(timer);

console.log("=== onActivated");

			// set a timer to debounce this event, since if many windows are open,
			// this will get called once for each active tab in each window on startup
		timer = setTimeout(onLastActivated, WindowActivatedDelay);
	}


	chrome.tabs.onActivated.addListener(onActivated);
});


require([
	"background/recent-tabs",
	"background/tracker",
	"cp"
], function(
	recentTabs,
	Tracker,
	cp
) {
	var backgroundTracker,
		popupTracker,
		popupIsOpen = false,
		addFromToggle = false;


	function addTab(
		tabID)
	{
		return cp.tabs.get(tabID)
			.then(recentTabs.add);
	}

	const debouncedAddTab = debounce(addTab, MinTabDwellTime);


	chrome.tabs.onActivated.addListener(function(event) {
		if (!gStartingUp) {
			if (addFromToggle) {
				addFromToggle = false;
				addTab(event.tabId);
			} else {
				debouncedAddTab(event.tabId);
			}
		}
	});


	chrome.tabs.onRemoved.addListener(function(tabID, removeInfo) {
		if (!gStartingUp) {
			recentTabs.remove(tabID, removeInfo);
		}
	});


		// the onActivated event isn't fired when the user switches between
		// windows, so get the active tab in this window and store it
	chrome.windows.onFocusChanged.addListener(function(windowID) {
		if (!gStartingUp && windowID != chrome.windows.WINDOW_ID_NONE) {
			cp.tabs.query({ active: true, windowId: windowID })
				.then(function(tabs) {
					if (tabs.length) {
						if (addFromToggle) {
							addFromToggle = false;
							addTab(tabs[0].id);
						} else {
							debouncedAddTab(tabs[0].id);
						}
					}
				});
		}
	});


	chrome.commands.onCommand.addListener(function(command) {
		if (command == "1-previous-tab") {
			recentTabs.toggleTab(-1);
			backgroundTracker.event("recents", "previous");
		} else if (command == "2-next-tab") {
			recentTabs.toggleTab(1);
			backgroundTracker.event("recents", "next");
		}
	});


	chrome.runtime.onConnect.addListener(function(port) {
		const connectTime = Date.now();

		popupIsOpen = true;

		port.onDisconnect.addListener(function() {
			popupIsOpen = false;

			if (Date.now() - connectTime < MaxPopupLifetime) {
					// pass true so toggleTab() knows this toggle is coming from
					// a double press of the shortcut.  set addFromToggle so that
					// the onActivated listener calls add immediately instead of
					// debouncing it.  otherwise, quickly repeated double presses
					// would be ignored because the tab list wouldn't have been
					// updated yet.
				addFromToggle = true;
				recentTabs.toggleTab(-1, true);
				backgroundTracker.event("recents", "toggle");
			} else {
					// send a background "pageview", since the popup is now closed,
					// so that GA will track the time the popup was open
				backgroundTracker.pageview();
			}
		});
	});


	chrome.runtime.onUpdateAvailable.addListener(function(details) {
		function restartExtension()
		{
			if (!popupIsOpen) {
console.log("=== reloading");
				chrome.runtime.reload();
			} else {
				setTimeout(restartExtension, RestartDelay);
			}
		}

		console.log("onUpdateAvailable", details);

		restartExtension();
	});


		// create a separate tracker for the background and popup pages, so the
		// events get tracked on the right page.  pass true to not do an
		// automatic pageview on creation.
	backgroundTracker = new Tracker(TrackerID, { name: "background" }, true);
	popupTracker = new Tracker(TrackerID, { name: "popup" }, true);
	window.tracker = popupTracker;

	cp.management.getSelf()
		.then(function(info) {
			if (info.installType == "development") {
				backgroundTracker.set("campaignName", "dev");
				backgroundTracker.set("campaignSource", "ext");
				backgroundTracker.set("campaignMedium", "ext");
				popupTracker.set("campaignName", "dev");
				popupTracker.set("campaignSource", "ext");
				popupTracker.set("campaignMedium", "ext");
			}

				// setting appVersion: info.version seems to cause realtime
				// events to not appear on the GA site
			backgroundTracker.set({
				location: "/background.html",
				page: "/background",
				transport: "beacon"
			});
			backgroundTracker.pageview();
			backgroundTracker.timing("loading", "background", performance.now());

			popupTracker.set({
				location: "/popup.html",
				page: "/popup",
				transport: "beacon"
			});
		});

	window.addEventListener("error", function(event) {
console.error("error", event);
		backgroundTracker.exception(event, true);
	});

	window.log = function() {
		console.log.apply(console, arguments);
	};
});
