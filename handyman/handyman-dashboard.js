import {
    auth,
    db
} from "../firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    updateDoc,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";


/* =========================================================
   ELEMENTS
========================================================= */

const welcomeTitle =
    document.getElementById("welcomeTitle");

const headerAvatar =
    document.getElementById("headerAvatar");

const profileAvatar =
    document.getElementById("profileAvatar");

const profileName =
    document.getElementById("profileName");

const profileService =
    document.getElementById("profileService");

const profileEmail =
    document.getElementById("profileEmail");

const profilePhone =
    document.getElementById("profilePhone");

const profileExperience =
    document.getElementById("profileExperience");

const profileRating =
    document.getElementById("profileRating");

const availabilityText =
    document.getElementById("availabilityText");

const pendingCount =
    document.getElementById("pendingCount");

const upcomingCount =
    document.getElementById("upcomingCount");

const completedCount =
    document.getElementById("completedCount");

const bookingCount =
    document.getElementById("bookingCount");

const bookingList =
    document.getElementById("bookingList");

const recentClients =
    document.getElementById("recentClients");

const logoutButton =
    document.getElementById("logoutButton");


let currentUser = null;
let currentUserData = null;
let pendingContractBookingId = null;

let unsubscribeBookings = null;


/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


function getInitial(name) {

    return (
        String(name || "H")
            .trim()
            .charAt(0)
            .toUpperCase() || "H"
    );

}


function formatDate(timestamp) {

    if (!timestamp) {
        return "No date";
    }

    try {

        const date =
            timestamp.toDate
                ? timestamp.toDate()
                : new Date(timestamp);

        return date.toLocaleDateString(
            [],
            {
                month: "short",
                day: "numeric",
                year: "numeric"
            }
        );

    } catch {

        return "No date";

    }

}


/* =========================================================
   LOAD HANDYMAN PROFILE
========================================================= */

async function loadProfile(
    user
) {

    const userRef =
        doc(
            db,
            "users",
            user.uid
        );


    const snapshot =
        await getDoc(
            userRef
        );


    if (!snapshot.exists()) {

        await signOut(auth);

        window.location.href =
            "../login.html";

        return false;
    }


    const data =
        snapshot.data();


    if (
        data.role !==
        "handyman"
    ) {

        await signOut(auth);

        window.location.href =
            "../login.html";

        return false;
    }


    currentUserData =
        data;


    const name =
        data.name ||
        user.displayName ||
        "Handyman";


    const service =
        data.serviceName ||
        data.serviceCategory ||
        "Handyman service";


    const initial =
        getInitial(name);


    welcomeTitle.textContent =
        `Welcome back, ${name.split(" ")[0]}`;


    profileName.textContent =
        name;


    profileService.textContent =
        service;


    profileEmail.textContent =
        data.email ||
        user.email ||
        "-";


    profilePhone.textContent =
        data.phone ||
        "-";


    profileExperience.textContent =
        data.experience ||
        "Not specified";


    profileAvatar.textContent =
        initial;


    headerAvatar.textContent =
        initial;


    availabilityText.textContent =
        data.isAvailable === false
            ? "Currently unavailable"
            : "Available";


    return true;

}


/* =========================================================
   LOAD RATING
========================================================= */

async function loadRating(
    handymanId
) {

    try {

        const reviewsQuery =
            query(
                collection(
                    db,
                    "reviews"
                ),
                where(
                    "handymanId",
                    "==",
                    handymanId
                )
            );


        const snapshot =
            await getDocs(
                reviewsQuery
            );


        if (snapshot.empty) {

            profileRating.textContent =
                "0.0";

            return;

        }


        let total =
            0;


        snapshot.forEach(
            item => {

                total +=
                    Number(
                        item.data().rating ||
                        0
                    );

            }
        );


        profileRating.textContent =
            (
                total /
                snapshot.size
            ).toFixed(1);


    } catch (error) {

        console.error(
            "HANDYMAN RATING ERROR:",
            error
        );

        profileRating.textContent =
            "0.0";

    }

}


/* =========================================================
   LOAD BOOKINGS REALTIME
========================================================= */

function loadBookings(
    handymanId
) {

    const bookingsQuery =
        query(
            collection(
                db,
                "bookings"
            ),
            where(
                "handymanId",
                "==",
                handymanId
            )
        );


    unsubscribeBookings =
        onSnapshot(
            bookingsQuery,
            snapshot => {

                const bookings =
                    snapshot.docs.map(
                        item => ({
                            id: item.id,
                            ...item.data()
                        })
                    );


                bookings.sort(
                    (a, b) => {

                        const first =
                            a.createdAt?.seconds ||
                            0;

                        const second =
                            b.createdAt?.seconds ||
                            0;

                        return second - first;

                    }
                );


                updateStatistics(
                    bookings
                );


                renderBookings(
                    bookings
                );


                renderRecentClients(
                    bookings
                );

            },
            error => {

                console.error(
                    "HANDYMAN BOOKINGS ERROR:",
                    error
                );


                bookingList.innerHTML = `
                    <div class="hd-error">
                        Unable to load your bookings.
                    </div>
                `;

            }
        );

}


/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics(
    bookings
) {

    const pending =
        bookings.filter(
            booking =>
                booking.status ===
                "pending"
        ).length;


    const upcoming =
        bookings.filter(
            booking =>
                booking.status ===
                "accepted" ||
                booking.status ===
                "confirmed" ||
                booking.status ===
                "scheduled"
        ).length;


    const completed =
        bookings.filter(
            booking =>
                booking.status ===
                "completed"
        ).length;


    pendingCount.textContent =
        pending;

    upcomingCount.textContent =
        upcoming;

    completedCount.textContent =
        completed;


    bookingCount.textContent =
        `${bookings.length} booking${bookings.length === 1 ? "" : "s"}`;

}


/* =========================================================
   RENDER BOOKINGS
========================================================= */

function renderBookings(
    bookings
) {

    if (!bookings.length) {

        bookingList.innerHTML = `
            <div class="hd-empty">
                No client bookings yet.
            </div>
        `;

        return;
    }


    bookingList.innerHTML =
        bookings
            .slice(0, 10)
            .map(
                booking => {

                    const clientName =
                        booking.clientName ||
                        "Client";


                    const service =
                        booking.serviceName ||
                        booking.service ||
                        "Handyman service";


                    const location =
                        booking.location ||
                        booking.address ||
                        "Location not provided";


                    const date =
                        booking.date ||
                        formatDate(
                            booking.scheduledAt
                        );


                    const time =
                        booking.time ||
                        "Time not specified";


                    const status =
                        booking.status ||
                        "pending";


                    return `
                        <article
                            class="hd-booking"
                            data-booking-id="${escapeHTML(booking.id)}"
                        >

                            <div class="hd-booking-top">

                                <div>

                                    <div class="hd-booking-name">
                                        ${escapeHTML(clientName)}
                                    </div>

                                    <div class="hd-booking-service">
                                        ${escapeHTML(service)}
                                    </div>

                                </div>

                                <span class="hd-status">
                                    ${escapeHTML(status)}
                                </span>

                            </div>


                            <div class="hd-booking-details">

                                <div class="hd-detail">

                                    <span>
                                        Date
                                    </span>

                                    <strong>
                                        ${escapeHTML(date)}
                                    </strong>

                                </div>


                                <div class="hd-detail">

                                    <span>
                                        Time
                                    </span>

                                    <strong>
                                        ${escapeHTML(time)}
                                    </strong>

                                </div>


                                <div class="hd-detail">

                                    <span>
                                        Location
                                    </span>

                                    <strong>
                                        ${escapeHTML(location)}
                                    </strong>

                                </div>


                                <div class="hd-detail">

                                    <span>
                                        Client mobile
                                    </span>

                                    <strong>
                                        ${escapeHTML(
                                            booking.clientMobile ||
                                            booking.clientPhone ||
                                            "Not provided"
                                        )}
                                    </strong>

                                </div>

                            </div>


                            <div class="hd-booking-actions">

                                ${
                                    status === "pending"
                                        ? `
                                            <button
                                                type="button"
                                                class="hd-button hd-button-primary"
                                                data-action="accept"
                                                data-id="${escapeHTML(booking.id)}"
                                            >
                                                Accept booking
                                            </button>

                                            <button
                                                type="button"
                                                class="hd-button hd-button-danger"
                                                data-action="decline"
                                                data-id="${escapeHTML(booking.id)}"
                                            >
                                                Decline
                                            </button>
                                        `
                                        : ""
                                }


                                ${
                                    status === "accepted" ||
                                    status === "confirmed" ||
                                    status === "scheduled"
                                        ? `
                                            <button
                                                type="button"
                                                class="hd-button hd-button-primary"
                                                data-action="message"
                                                data-id="${escapeHTML(booking.id)}"
                                                data-client="${escapeHTML(booking.clientId || "")}"
                                                data-client-name="${escapeHTML(clientName)}"
                                            >
                                                Message client
                                            </button>

                                            <button
                                                type="button"
                                                class="hd-button hd-button-secondary"
                                                data-action="complete"
                                                data-id="${escapeHTML(booking.id)}"
                                            >
                                                Mark completed
                                            </button>
                                        `
                                        : ""
                                }


                                ${
                                    status === "completed"
                                        ? `
                                            <button
                                                type="button"
                                                class="hd-button hd-button-secondary"
                                                data-action="message"
                                                data-id="${escapeHTML(booking.id)}"
                                                data-client="${escapeHTML(booking.clientId || "")}"
                                                data-client-name="${escapeHTML(clientName)}"
                                            >
                                                Message client
                                            </button>
                                        `
                                        : ""
                                }

                            </div>

                        </article>
                    `;

                }
            )
            .join("");


    attachBookingActions();

}


/* =========================================================
   RECENT CLIENTS
========================================================= */

function renderRecentClients(
    bookings
) {

    if (!bookings.length) {

        recentClients.innerHTML = `
            <div class="hd-empty">
                Client activity will appear here.
            </div>
        `;

        return;
    }


    recentClients.innerHTML =
        bookings
            .slice(0, 5)
            .map(
                booking => {

                    const name =
                        booking.clientName ||
                        "Client";


                    const service =
                        booking.serviceName ||
                        booking.service ||
                        "Service";


                    const status =
                        booking.status ||
                        "pending";


                    return `
                        <article class="hd-booking">

                            <div class="hd-booking-top">

                                <div>

                                    <div class="hd-booking-name">
                                        ${escapeHTML(name)}
                                    </div>

                                    <div class="hd-booking-service">
                                        ${escapeHTML(service)}
                                    </div>

                                </div>

                                <span class="hd-status">
                                    ${escapeHTML(status)}
                                </span>

                            </div>

                        </article>
                    `;

                }
            )
            .join("");

}


/* =========================================================
   BOOKING ACTIONS
========================================================= */

function openContractModal(bookingId) {

    pendingContractBookingId = bookingId;

    const modal =
        document.getElementById(
            "bookingContractModal"
        );

    const checkbox =
        document.getElementById(
            "bookingContractCheckbox"
        );

    if (checkbox) {
        checkbox.checked = false;
    }

    if (modal) {
        modal.classList.add("active");
    }

}


function closeContractModal() {

    const modal =
        document.getElementById(
            "bookingContractModal"
        );

    const checkbox =
        document.getElementById(
            "bookingContractCheckbox"
        );

    if (checkbox) {
        checkbox.checked = false;
    }

    if (modal) {
        modal.classList.remove("active");
    }

    pendingContractBookingId = null;

}


function attachBookingActions() {

    document
        .querySelectorAll(
            "[data-action]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                async () => {

                    const action =
                        button.dataset.action;

                    const bookingId =
                        button.dataset.id;


                    if (
                        action ===
                        "message"
                    ) {

                        await openClientChat(
                            bookingId,
                            button.dataset.client,
                            button.dataset.clientName
                        );

                        return;
                    }


                    if (
                        action ===
                        "accept"
                    ) {

                        openContractModal(
                            bookingId
                        );

                        return;
                    }


                    if (
                        action ===
                        "decline"
                    ) {

                        await updateBookingStatus(
                            bookingId,
                            "declined"
                        );

                        return;
                    }


                    if (
                        action ===
                        "complete"
                    ) {

                        await updateBookingStatus(
                            bookingId,
                            "completed"
                        );

                    }

                }
            );

        });

    const acceptContractButton =
        document.getElementById(
            "confirmBookingContractButton"
        );

    if (acceptContractButton) {

        acceptContractButton.addEventListener(
            "click",
            async () => {

                const checkbox =
                    document.getElementById(
                        "bookingContractCheckbox"
                    );

                if (!checkbox || !checkbox.checked) {
                    alert(
                        "Please read the contract and confirm that you agree before accepting this booking."
                    );
                    return;
                }

                if (!pendingContractBookingId) {
                    return;
                }

                await updateBookingStatus(
                    pendingContractBookingId,
                    "accepted"
                );

                await updateDoc(
                    doc(
                        db,
                        "bookings",
                        pendingContractBookingId
                    ),
                    {
                        contractAccepted: true,
                        contractAcceptedBy: currentUser.uid,
                        contractAcceptedAt: serverTimestamp(),
                        contractText: "Handyman confirms reading and accepting the job agreement before accepting the booking."
                    }
                );

                closeContractModal();

            }
        );

    }

    document
        .querySelectorAll(
            "[data-close-contract]"
        )
        .forEach(button => {
            button.addEventListener(
                "click",
                closeContractModal
            );
        });

}


/* =========================================================
   UPDATE BOOKING STATUS
========================================================= */

async function updateBookingStatus(
    bookingId,
    status
) {

    try {

        const bookingRef =
            doc(
                db,
                "bookings",
                bookingId
            );


        await updateDoc(
            bookingRef,
            {
                status:
                    status,
                updatedAt:
                    serverTimestamp()
            }
        );


    } catch (error) {

        console.error(
            "BOOKING STATUS ERROR:",
            error
        );


        if (
            error.code ===
            "permission-denied"
        ) {

            alert(
                "Firebase blocked this booking update. Check your Firestore rules."
            );

        } else {

            alert(
                "Unable to update the booking."
            );

        }

    }

}


/* =========================================================
   OPEN CLIENT CHAT
========================================================= */

async function openClientChat(
    bookingId,
    clientId,
    clientName
) {

    if (!clientId) {

        alert(
            "This booking does not have a valid client ID."
        );

        return;
    }


    try {

        const conversationId =
            [
                currentUser.uid,
                clientId
            ]
                .sort()
                .join("_");


        const conversationRef =
            doc(
                db,
                "conversations",
                conversationId
            );


        const existing =
            await getDoc(
                conversationRef
            );


        if (!existing.exists()) {

            await import(
                "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js"
            )
            .then(
                async firestore => {

                    await firestore.setDoc(
                        conversationRef,
                        {
                            clientId:
                                clientId,

                            handymanId:
                                currentUser.uid,

                            clientName:
                                clientName ||
                                "Client",

                            handymanName:
                                currentUserData?.name ||
                                currentUser.displayName ||
                                "Handyman",

                            bookingId:
                                bookingId,

                            lastMessage:
                                "",

                            lastSenderId:
                                "",

                            createdAt:
                                firestore.serverTimestamp(),

                            updatedAt:
                                firestore.serverTimestamp()
                        }
                    );

                }
            );

        }


        window.location.href =
            "./handyman-chat.html";


    } catch (error) {

        console.error(
            "OPEN CLIENT CHAT ERROR:",
            error
        );


        alert(
            error.code === "permission-denied"
                ? "Firebase blocked the conversation. Check your Firestore rules."
                : "Unable to open the client chat."
        );

    }

}


/* =========================================================
   LOGOUT
========================================================= */

logoutButton?.addEventListener(
    "click",
    async () => {

        try {

            if (unsubscribeBookings) {
                unsubscribeBookings();
            }

            await signOut(
                auth
            );

            window.location.href =
                "../login.html";

        } catch (error) {

            console.error(
                "HANDYMAN LOGOUT ERROR:",
                error
            );

        }

    }
);


/* =========================================================
   AUTH
========================================================= */

onAuthStateChanged(
    auth,
    async user => {

        if (!user) {

            window.location.href =
                "../login.html";

            return;
        }


        currentUser =
            user;


        try {

            const profileLoaded =
                await loadProfile(
                    user
                );


            if (!profileLoaded) {
                return;
            }


            await loadRating(
                user.uid
            );


            loadBookings(
                user.uid
            );


        } catch (error) {

            console.error(
                "HANDYMAN DASHBOARD ERROR:",
                error
            );


            bookingList.innerHTML = `
                <div class="hd-error">
                    Unable to load your dashboard.
                </div>
            `;

        }

    }
);