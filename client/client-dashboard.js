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
    onSnapshot,
    addDoc,
    updateDoc,
    setDoc,
    serverTimestamp,
    orderBy
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";


// ======================================================
// GLOBAL STATE
// ======================================================

let currentUser = null;
let currentProfile = null;

let handymanList = [];
let handymanReviews = {};

let clientLatitude = null;
let clientLongitude = null;

let selectedHandyman = null;
let selectedRatingBooking = null;
let selectedRating = 0;
let isBookingSubmitting = false;

let unsubscribeHandymen = null;
let unsubscribeBookings = null;
let unsubscribeReviews = null;
let unsubscribeNotifications = null;
let unsubscribeConversations = null;


// ======================================================
// HELPERS
// ======================================================

function escapeHTML(value) {
    if (value === null || value === undefined) return "";

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function getTimestampMillis(value) {
    if (!value) return 0;

    if (typeof value.toMillis === "function") {
        return value.toMillis();
    }

    if (value.seconds) {
        return value.seconds * 1000;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    const parsed = new Date(value).getTime();

    return Number.isNaN(parsed) ? 0 : parsed;
}


function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (
        lat1 === null ||
        lon1 === null ||
        lat2 === null ||
        lon2 === null
    ) {
        return null;
    }

    const earthRadius = 6371;

    const dLat =
        (lat2 - lat1) *
        Math.PI /
        180;

    const dLon =
        (lon2 - lon1) *
        Math.PI /
        180;

    const a =
        Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadius * c;
}


function getInitials(name) {
    if (!name) return "H";

    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(word => word.charAt(0).toUpperCase())
        .join("");
}


function getHandymanName(handyman) {
    return (
        handyman.name ||
        handyman.displayName ||
        handyman.fullName ||
        `${handyman.firstName || ""} ${handyman.lastName || ""}`.trim() ||
        "Handyman"
    );
}


function getHandymanService(handyman) {
    return (
        handyman.serviceName ||
        handyman.service ||
        handyman.category ||
        handyman.specialization ||
        "General Handyman"
    );
}


function isHandymanOnline(handyman) {
    return (
        handyman.isOnline === true ||
        handyman.online === true ||
        handyman.available === true ||
        handyman.status === "online" ||
        handyman.status === "available"
    );
}


function isHandymanVerified(handyman) {
    return (
        handyman.verified === true ||
        handyman.isVerified === true ||
        handyman.verificationStatus === "verified"
    );
}


// ======================================================
// AUTH
// ======================================================

onAuthStateChanged(auth, async user => {

    if (!user) {
        window.location.href = "../login.html";
        return;
    }

    currentUser = user;

    try {

        const userRef = doc(
            db,
            "users",
            user.uid
        );

        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            console.error("User profile does not exist.");
            return;
        }

        currentProfile = {
            uid: user.uid,
            ...userSnap.data()
        };

        if (currentProfile.role !== "client") {
            window.location.href = "../login.html";
            return;
        }

        initializeDashboard();

    } catch (error) {

        console.error(
            "Authentication/profile error:",
            error
        );

    }

});


// ======================================================
// INITIALIZE
// ======================================================

function initializeDashboard() {

    loadClientProfile();

    setupHandymanRealtime();

    setupBookingRealtime();

    setupReviewRealtime();

    setupNotificationRealtime();

    setupLocation();

    setupDashboardEvents();

    setupRatingEvents();

    setupLogout();

}


// ======================================================
// CLIENT PROFILE
// ======================================================

function loadClientProfile() {

    const name =
        currentProfile.name ||
        currentProfile.displayName ||
        currentProfile.fullName ||
        `${currentProfile.firstName || ""} ${currentProfile.lastName || ""}`.trim() ||
        "Client";

    document
        .querySelectorAll("[data-client-name]")
        .forEach(element => {
            element.textContent = name;
        });

    document
        .querySelectorAll("[data-client-email]")
        .forEach(element => {
            element.textContent =
                currentProfile.email ||
                currentUser.email ||
                "";
        });

}


// ======================================================
// HANDYMAN REALTIME
// ======================================================

function setupHandymanRealtime() {

    if (unsubscribeHandymen) {
        unsubscribeHandymen();
    }

    const handymanQuery = query(
        collection(db, "users"),
        where("role", "==", "handyman")
    );

    unsubscribeHandymen = onSnapshot(
        handymanQuery,
        async snapshot => {

            const handymen = [];

            snapshot.forEach(handymanDoc => {

                const data = handymanDoc.data();

                handymen.push({
                    uid: handymanDoc.id,
                    ...data
                });

            });

            handymanList = handymen;

            await loadHandymanRatings();

            sortHandymen();

            renderHandymen();

            populateBookingHandymen();

            renderMapMarkers();

        },
        error => {

            console.error(
                "Handyman realtime error:",
                error
            );

        }
    );

}


// ======================================================
// REVIEWS
// ======================================================

async function loadHandymanRatings() {

    handymanReviews = {};

    try {

        const reviewSnapshot =
            await getDocs(
                collection(db, "reviews")
            );

        reviewSnapshot.forEach(reviewDoc => {

            const review =
                reviewDoc.data();

            if (!review.handymanId) {
                return;
            }

            if (!handymanReviews[review.handymanId]) {
                handymanReviews[review.handymanId] = [];
            }

            handymanReviews[
                review.handymanId
            ].push(review);

        });

        handymanList.forEach(handyman => {

            const reviews =
                handymanReviews[handyman.uid] || [];

            const total = reviews.reduce(
                (sum, review) =>
                    sum + Number(review.rating || 0),
                0
            );

            handyman.rating =
                reviews.length
                    ? total / reviews.length
                    : Number(handyman.rating || 0);

            handyman.reviewCount =
                reviews.length ||
                Number(handyman.reviewCount || 0);

        });

    } catch (error) {

        console.error(
            "Review loading error:",
            error
        );

    }

}


// ======================================================
// REVIEW REALTIME
// ======================================================

function setupReviewRealtime() {

    if (unsubscribeReviews) {
        unsubscribeReviews();
    }

    unsubscribeReviews = onSnapshot(
        collection(db, "reviews"),
        async () => {

            await loadHandymanRatings();

            sortHandymen();

            renderHandymen();

            renderMapMarkers();

        },
        error => {

            console.error(
                "Review realtime error:",
                error
            );

        }
    );

}


// ======================================================
// SORTING
// ======================================================

function sortHandymen() {

    const selectedService =
        document.querySelector(
            "#bookingService"
        )?.value?.trim().toLowerCase() || "";

    handymanList.sort((a, b) => {

        const aService =
            getHandymanService(a)
                .toLowerCase();

        const bService =
            getHandymanService(b)
                .toLowerCase();

        const aServiceMatch =
            selectedService &&
            (
                aService.includes(selectedService) ||
                selectedService.includes(aService)
            );

        const bServiceMatch =
            selectedService &&
            (
                bService.includes(selectedService) ||
                selectedService.includes(bService)
            );

        if (aServiceMatch !== bServiceMatch) {
            return bServiceMatch - aServiceMatch;
        }


        const verifiedA =
            isHandymanVerified(a);

        const verifiedB =
            isHandymanVerified(b);

        if (verifiedA !== verifiedB) {
            return verifiedB - verifiedA;
        }


        const onlineA =
            isHandymanOnline(a);

        const onlineB =
            isHandymanOnline(b);

        if (onlineA !== onlineB) {
            return onlineB - onlineA;
        }


        const ratingA =
            Number(a.rating || 0);

        const ratingB =
            Number(b.rating || 0);

        if (ratingA !== ratingB) {
            return ratingB - ratingA;
        }


        const reviewsA =
            Number(a.reviewCount || 0);

        const reviewsB =
            Number(b.reviewCount || 0);

        if (reviewsA !== reviewsB) {
            return reviewsB - reviewsA;
        }


        const distanceA =
            a.distanceKm ?? Infinity;

        const distanceB =
            b.distanceKm ?? Infinity;

        if (distanceA !== distanceB) {
            return distanceA - distanceB;
        }


        return getHandymanName(a)
            .localeCompare(
                getHandymanName(b)
            );

    });

}


// ======================================================
// RENDER HANDYMEN
// ======================================================

function renderHandymen() {

    const grid =
        document.querySelector(
            "#handymanGrid"
        ) ||
        document.querySelector(
            ".hd-handyman-grid"
        );

    if (!grid) {
        console.error(
            "Handyman grid not found."
        );
        return;
    }

    grid.innerHTML = "";

    if (!handymanList.length) {
        return;
    }

    handymanList.forEach(handyman => {

        const name =
            getHandymanName(handyman);

        const service =
            getHandymanService(handyman);

        const rating =
            Number(handyman.rating || 0);

        const reviewCount =
            Number(
                handyman.reviewCount || 0
            );

        const online =
            isHandymanOnline(handyman);

        const verified =
            isHandymanVerified(handyman);

        const distance =
            handyman.distanceKm !== null &&
            handyman.distanceKm !== undefined
                ? `${handyman.distanceKm.toFixed(1)} km`
                : "Nearby";

        const initials =
            getInitials(name);

        const card =
            document.createElement("div");

        card.className =
            "hd-handyman-card";

        card.dataset.handymanId =
            handyman.uid;

        card.innerHTML = `

            <div class="hd-handyman-avatar">
                ${
                    handyman.photoURL ||
                    handyman.profileImage ||
                    handyman.photo
                        ? `
                            <img
                                src="${escapeHTML(
                                    handyman.photoURL ||
                                    handyman.profileImage ||
                                    handyman.photo
                                )}"
                                alt="${escapeHTML(name)}"
                            >
                          `
                        : `
                            <span>
                                ${escapeHTML(initials)}
                            </span>
                          `
                }

                <span
                    class="hd-online-dot ${
                        online
                            ? "online"
                            : ""
                    }"
                ></span>
            </div>

            <div class="hd-handyman-info">

                <div class="hd-handyman-name-row">

                    <h3>
                        ${escapeHTML(name)}
                    </h3>

                    ${
                        verified
                            ? `
                                <span
                                    class="hd-verified-badge"
                                    title="Verified"
                                >
                                    ✓
                                </span>
                              `
                            : ""
                    }

                </div>

                <p class="hd-handyman-service">
                    ${escapeHTML(service)}
                </p>

                <div class="hd-handyman-meta">

                    <span>
                        ★
                        ${rating
                            ? rating.toFixed(1)
                            : "New"}
                    </span>

                    <span>
                        ${
                            reviewCount
                                ? `(${reviewCount})`
                                : "(No reviews)"
                        }
                    </span>

                    <span>
                        ${distance}
                    </span>

                </div>

                <div class="hd-handyman-status">

                    ${
                        online
                            ? `
                                <span>
                                    Available
                                </span>
                              `
                            : `
                                <span>
                                    Offline
                                </span>
                              `
                    }

                </div>

                <button
                    type="button"
                    class="hd-select-handyman"
                    data-handyman-id="${escapeHTML(handyman.uid)}"
                >
                    Book Handyman
                </button>

            </div>

        `;

        grid.appendChild(card);

    });

    setupHandymanCardEvents();

}


// ======================================================
// HANDYMAN CARD EVENTS
// ======================================================

function openBookingModal(serviceName = "", handyman = null) {

    const modal =
        document.querySelector(
            "#bookingModal"
        );

    if (!modal) {
        return;
    }

    const serviceSelect =
        document.querySelector(
            "#bookingService"
        );

    if (serviceName && serviceSelect) {

        const options =
            Array.from(
                serviceSelect.options
            );

        const match =
            options.findIndex(
                option =>
                    option.textContent
                        .trim()
                        .toLowerCase() ===
                    serviceName
                        .toLowerCase()
            );

        if (match >= 0) {
            serviceSelect.selectedIndex =
                match;
        }

    }

    const handymanSelect =
        document.querySelector(
            "#bookingHandyman"
        );

    if (handyman && handymanSelect) {
        handymanSelect.value =
            handyman.uid;
    }

    modal.classList.add("active");

}

window.openBookingModal = openBookingModal;
window.submitBookingRequest = submitBookingRequest;


function setupHandymanCardEvents() {

    document
        .querySelectorAll(
            ".hd-select-handyman"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const handymanId =
                        button.dataset.handymanId;

                    const handyman =
                        handymanList.find(
                            item =>
                                item.uid ===
                                handymanId
                        );

                    if (!handyman) {
                        return;
                    }

                    selectedHandyman =
                        handyman;

                    const serviceName =
                        document.querySelector(
                            "#bookingService"
                        )?.value ||
                        getHandymanService(handyman);

                    const select =
                        document.querySelector(
                            "#bookingHandyman"
                        );

                    if (select) {
                        select.value =
                            handyman.uid;
                    }

                    openBookingModal(
                        serviceName,
                        handyman
                    );

                    const bookingSection =
                        document.querySelector(
                            "#bookingSection"
                        );

                    if (bookingSection) {
                        bookingSection
                            .scrollIntoView({
                                behavior: "smooth",
                                block: "start"
                            });
                    }

                }
            );

        });

}


// ======================================================
// BOOKING HANDYMAN SELECT
// ======================================================

function populateBookingHandymen() {

    const select =
        document.querySelector(
            "#bookingHandyman"
        );

    if (!select) {
        return;
    }

    const currentValue =
        select.value;

    select.innerHTML = `
        <option value="">
            Any available verified handyman
        </option>
    `;

    handymanList.forEach(handyman => {

        const option =
            document.createElement("option");

        option.value =
            handyman.uid;

        option.textContent =
            `${getHandymanName(handyman)} • ${getHandymanService(handyman)}`;

        select.appendChild(option);

    });

    if (
        currentValue &&
        handymanList.some(
            handyman =>
                handyman.uid === currentValue
        )
    ) {
        select.value = currentValue;
    }

}


// ======================================================
// LOCATION
// ======================================================

function setupLocation() {

    if (!navigator.geolocation) {
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {

            clientLatitude =
                position.coords.latitude;

            clientLongitude =
                position.coords.longitude;

            handymanList.forEach(
                handyman => {

                    const latitude =
                        Number(
                            handyman.latitude ??
                            handyman.locationCoordinates?.lat ??
                            handyman.location?.latitude
                        );

                    const longitude =
                        Number(
                            handyman.longitude ??
                            handyman.locationCoordinates?.lng ??
                            handyman.location?.longitude
                        );

                    if (
                        Number.isFinite(latitude) &&
                        Number.isFinite(longitude)
                    ) {

                        handyman.distanceKm =
                            calculateDistanceKm(
                                clientLatitude,
                                clientLongitude,
                                latitude,
                                longitude
                            );

                    } else {

                        handyman.distanceKm =
                            null;

                    }

                }
            );

            sortHandymen();

            renderHandymen();

            renderMapMarkers();

        },
        error => {

            console.warn(
                "Client location unavailable:",
                error.message
            );

        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );

}


// ======================================================
// MAP MARKERS
// ======================================================

function renderMapMarkers() {

    const map =
        document.querySelector(
            ".hd-map"
        );

    if (!map) {
        return;
    }

    map
        .querySelectorAll(
            ".hd-dynamic-marker"
        )
        .forEach(marker =>
            marker.remove()
        );

    handymanList.forEach(
        (handyman, index) => {

            const marker =
                document.createElement("button");

            marker.type = "button";

            marker.className =
                "hd-map-marker hd-dynamic-marker";

            marker.dataset.handymanId =
                handyman.uid;

            const columns = 4;

            const row =
                Math.floor(index / columns);

            const column =
                index % columns;

            marker.style.left =
                `${18 + column * 21}%`;

            marker.style.top =
                `${25 + row * 22}%`;

            marker.innerHTML = `
                <span>
                    ${escapeHTML(
                        getInitials(
                            getHandymanName(
                                handyman
                            )
                        )
                    )}
                </span>
            `;

            marker.title =
                getHandymanName(handyman);

            marker.addEventListener(
                "click",
                () => {

                    const card =
                        document.querySelector(
                            `[data-handyman-id="${handyman.uid}"]`
                        );

                    if (card) {

                        card.scrollIntoView({
                            behavior: "smooth",
                            block: "center"
                        });

                    }

                }
            );

            map.appendChild(marker);

        }
    );

}


// ======================================================
// BOOKING REALTIME
// ======================================================

function setupBookingRealtime() {

    if (unsubscribeBookings) {
        unsubscribeBookings();
    }

    const bookingQuery = query(
        collection(db, "bookings"),
        where(
            "clientId",
            "==",
            currentUser.uid
        )
    );

    unsubscribeBookings = onSnapshot(
        bookingQuery,
        snapshot => {

            const bookings = [];

            snapshot.forEach(
                bookingDoc => {

                    bookings.push({
                        id: bookingDoc.id,
                        ...bookingDoc.data()
                    });

                }
            );

            bookings.sort(
                (a, b) =>
                    getTimestampMillis(
                        b.createdAt
                    ) -
                    getTimestampMillis(
                        a.createdAt
                    )
            );

            renderAppointments(
                bookings
            );

        },
        error => {

            console.error(
                "Booking realtime error:",
                error
            );

        }
    );

}


// ======================================================
// APPOINTMENTS
// ======================================================

function renderAppointments(
    bookings
) {

    const list =
        document.querySelector(
            "#appointmentList"
        );

    if (!list) {
        return;
    }

    list.innerHTML = "";

    if (!bookings.length) {
        return;
    }

    bookings.forEach(booking => {

        const status =
            String(
                booking.status || "pending"
            ).toLowerCase();

        const appointment =
            document.createElement("div");

        appointment.className =
            `hd-appointment ${
                status === "completed"
                    ? "hd-completed-appointment"
                    : ""
            }`;

        appointment.innerHTML = `

            <div class="hd-appointment-info">

                <h3>
                    ${escapeHTML(
                        booking.handymanName ||
                        "Handyman"
                    )}
                </h3>

                <p>
                    ${escapeHTML(
                        booking.service ||
                        booking.serviceName ||
                        "Service"
                    )}
                </p>

                <p>
                    ${escapeHTML(
                        booking.date ||
                        ""
                    )}
                    ${
                        booking.time
                            ? ` • ${escapeHTML(
                                booking.time
                              )}`
                            : ""
                    }
                </p>

                <span class="hd-status ${escapeHTML(status)}">
                    ${escapeHTML(
                        status.charAt(0).toUpperCase() +
                        status.slice(1)
                    )}
                </span>

            </div>

            <div class="hd-appointment-actions">

                ${
                    status === "completed"
                        ? `
                            <button
                                type="button"
                                class="hd-rate-button"
                                data-rate-booking="${escapeHTML(
                                    booking.id
                                )}"
                            >
                                Rate Handyman
                            </button>
                          `
                        : ""
                }

            </div>

        `;

        list.appendChild(
            appointment
        );

    });

    document
        .querySelectorAll(
            "[data-rate-booking]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                async () => {

                    const booking =
                        bookings.find(
                            item =>
                                item.id ===
                                button.dataset.rateBooking
                        );

                    if (booking) {
                        openRatingModal(
                            booking
                        );
                    }

                }
            );

        });

}


// ======================================================
// RATING MODAL
// ======================================================

function openRatingModal(
    booking
) {

    selectedRatingBooking =
        booking;

    selectedRating = 0;

    const modal =
        document.querySelector(
            "#ratingModal"
        );

    if (!modal) {
        return;
    }

    const name =
        document.querySelector(
            "#ratingHandymanName"
        );

    if (name) {

        name.textContent =
            booking.handymanName ||
            "Handyman";

    }

    const ratingValue =
        document.querySelector(
            "#ratingValue"
        );

    if (ratingValue) {
        ratingValue.textContent =
            "0 / 5";
    }

    const comment =
        document.querySelector(
            "#ratingComment"
        );

    if (comment) {
        comment.value = "";
    }

    updateRatingStars();

    modal.classList.add(
        "active"
    );

}


function updateRatingStars() {

    document
        .querySelectorAll(
            ".hd-rating-star"
        )
        .forEach(star => {

            const value =
                Number(
                    star.dataset.rating
                );

            star.classList.toggle(
                "selected",
                value <= selectedRating
            );

        });

    const value =
        document.querySelector(
            "#ratingValue"
        );

    if (value) {

        value.textContent =
            `${selectedRating} / 5`;

    }

}


function setupRatingEvents() {

    document
        .querySelectorAll(
            ".hd-rating-star"
        )
        .forEach(star => {

            star.addEventListener(
                "click",
                () => {

                    selectedRating =
                        Number(
                            star.dataset.rating
                        );

                    updateRatingStars();

                }
            );

        });


    const submit =
        document.querySelector(
            "#submitRatingButton"
        );

    if (submit) {

        submit.addEventListener(
            "click",
            submitRating
        );

    }


    document
        .querySelectorAll(
            "[data-close-rating]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                closeRatingModal
            );

        });

}


function closeRatingModal() {

    const modal =
        document.querySelector(
            "#ratingModal"
        );

    if (modal) {
        modal.classList.remove(
            "active"
        );
    }

    selectedRatingBooking =
        null;

    selectedRating = 0;

}


async function submitRating() {

    if (!selectedRatingBooking) {
        return;
    }

    if (
        selectedRating < 1 ||
        selectedRating > 5
    ) {
        alert(
            "Please select a rating first."
        );
        return;
    }

    const booking =
        selectedRatingBooking;

    const handymanId =
        booking.handymanId;

    if (!handymanId) {
        alert(
            "Handyman information is missing."
        );
        return;
    }

    const submitButton =
        document.querySelector(
            "#submitRatingButton"
        );

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
            "Submitting...";
    }

    try {

        const existingReviewQuery =
            query(
                collection(db, "reviews"),
                where(
                    "bookingId",
                    "==",
                    booking.id
                ),
                where(
                    "clientId",
                    "==",
                    currentUser.uid
                )
            );

        const existingReviews =
            await getDocs(
                existingReviewQuery
            );

        if (!existingReviews.empty) {

            alert(
                "You already rated this booking."
            );

            closeRatingModal();

            return;
        }


        const comment =
            document.querySelector(
                "#ratingComment"
            )?.value?.trim() || "";


        await addDoc(
            collection(db, "reviews"),
            {
                bookingId: booking.id,

                clientId:
                    currentUser.uid,

                clientName:
                    currentProfile.name ||
                    currentProfile.displayName ||
                    "Client",

                handymanId,

                handymanName:
                    booking.handymanName ||
                    "Handyman",

                rating:
                    selectedRating,

                comment,

                createdAt:
                    serverTimestamp()
            }
        );


        await createNotification(
            handymanId,
            "New Review",
            `${currentProfile.name || "A client"} rated your service ${selectedRating}/5.`,
            "review",
            booking.id
        );


        closeRatingModal();

        alert(
            "Your rating has been submitted."
        );


    } catch (error) {

        console.error(
            "Rating submission error:",
            error
        );

        alert(
            "Unable to submit your rating. Please try again."
        );

    } finally {

        if (submitButton) {

            submitButton.disabled =
                false;

            submitButton.textContent =
                "Submit Rating";

        }

    }

}


// ======================================================
// NOTIFICATIONS
// ======================================================

function setupNotificationRealtime() {

    if (unsubscribeNotifications) {
        unsubscribeNotifications();
    }

    const notificationQuery =
        query(
            collection(db, "notifications"),
            where(
                "userId",
                "==",
                currentUser.uid
            )
        );

    unsubscribeNotifications =
        onSnapshot(
            notificationQuery,
            snapshot => {

                const notifications =
                    [];

                snapshot.forEach(
                    notificationDoc => {

                        notifications.push({
                            id:
                                notificationDoc.id,
                            ...notificationDoc.data()
                        });

                    }
                );

                notifications.sort(
                    (a, b) =>
                        getTimestampMillis(
                            b.createdAt
                        ) -
                        getTimestampMillis(
                            a.createdAt
                        )
                );

                renderNotifications(
                    notifications
                );

            },
            error => {

                console.error(
                    "Notification error:",
                    error
                );

            }
        );

}


function renderNotifications(
    notifications
) {

    const badge =
        document.querySelector(
            "[data-notification-count]"
        );

    if (!badge) {
        return;
    }

    const unread =
        notifications.filter(
            notification =>
                notification.read !== true
        ).length;

    badge.textContent =
        unread > 99
            ? "99+"
            : String(unread);

    badge.style.display =
        unread
            ? ""
            : "none";

}


// ======================================================
// CREATE NOTIFICATION
// ======================================================

async function createNotification(
    userId,
    title,
    message,
    type = "general",
    relatedId = ""
) {

    try {

        const notificationId =
            `${userId}_${type}_${relatedId || Date.now()}`;

        const notificationRef =
            doc(
                db,
                "notifications",
                notificationId
            );

        const existing =
            await getDoc(
                notificationRef
            );

        if (existing.exists()) {
            return;
        }

        await setDoc(
            notificationRef,
            {
                userId,

                title,

                message,

                type,

                relatedId,

                read: false,

                createdBy:
                    currentUser.uid,

                createdAt:
                    serverTimestamp()
            }
        );

    } catch (error) {

        console.error(
            "Notification creation error:",
            error
        );

    }

}


// ======================================================
// BOOKING SUBMIT
// ======================================================

async function submitBookingRequest() {

    if (isBookingSubmitting) {
        return;
    }

    isBookingSubmitting = true;

    const serviceSelect =
        document.querySelector(
            "#bookingService"
        );

    const handymanSelect =
        document.querySelector(
            "#bookingHandyman"
        );

    const dateInput =
        document.querySelector(
            "#bookingDate"
        );

    const timeInput =
        document.querySelector(
            "#bookingTime"
        );

    const addressInput =
        document.querySelector(
            "#bookingAddress"
        );

    const notesInput =
        document.querySelector(
            "#bookingNotes"
        );

    const service =
        serviceSelect?.value?.trim() || "";

    const handymanId =
        handymanSelect?.value?.trim() || "";

    const date =
        dateInput?.value?.trim() || "";

    const time =
        timeInput?.value?.trim() || "";

    const address =
        addressInput?.value?.trim() || "";

    const notes =
        notesInput?.value?.trim() || "";

    if (!service) {
        alert("Please select a service first.");
        return;
    }

    if (!handymanId) {
        alert("Please pick a handyman before requesting the booking.");
        return;
    }

    const selectedHandyman =
        handymanList.find(
            item => item.uid === handymanId
        );

    if (!selectedHandyman) {
        alert("Selected handyman was not found.");
        return;
    }

    const submitButton =
        document.querySelector(
            "#confirmBookingButton"
        );

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Sending request...";
    }

    try {

        const bookingRef =
            await addDoc(
                collection(db, "bookings"),
                {
                    clientId: currentUser.uid,
                    clientName:
                        currentProfile?.name ||
                        currentProfile?.displayName ||
                        "Client",
                    clientEmail:
                        currentProfile?.email ||
                        currentUser.email || "",
                    clientPhone:
                        currentProfile?.phone ||
                        currentProfile?.mobile || "",
                    handymanId: selectedHandyman.uid,
                    handymanName:
                        getHandymanName(selectedHandyman),
                    serviceName: service,
                    service: service,
                    date,
                    time,
                    address,
                    notes,
                    status: "pending",
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }
            );

        await createNotification(
            selectedHandyman.uid,
            "New booking request",
            `${currentProfile?.name || "A client"} requested ${service} for ${date || "a selected date"}.`,
            "booking",
            bookingRef.id
        );

        const bookingModal =
            document.querySelector(
                "#bookingModal"
            );

        if (bookingModal) {
            bookingModal.classList.remove("active");
        }

        alert("Your booking request has been sent to the handyman.");

        if (dateInput) dateInput.value = "";
        if (timeInput) timeInput.value = "";
        if (addressInput) addressInput.value = "";
        if (notesInput) notesInput.value = "";

    } catch (error) {

        console.error(
            "Booking submission error:",
            error
        );

        alert(
            "Unable to send the booking request. Please try again."
        );

    } finally {

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Request booking";
        }

        isBookingSubmitting = false;

    }

}


// ======================================================
// DASHBOARD EVENTS
// ======================================================

function setupDashboardEvents() {

    const serviceSelect =
        document.querySelector(
            "#bookingService"
        );

    if (serviceSelect) {

        serviceSelect.addEventListener(
            "change",
            () => {

                sortHandymen();

                renderHandymen();

                populateBookingHandymen();

            }
        );

    }

    document
        .querySelectorAll(
            ".hd-quick-service"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const serviceName =
                        button.dataset.service ||
                        button.textContent.trim();

                    if (serviceSelect) {

                        const options =
                            Array.from(
                                serviceSelect.options
                            );

                        const selectedIndex =
                            options.findIndex(
                                option =>
                                    option.textContent
                                        .trim()
                                        .toLowerCase() ===
                                    serviceName
                                        .toLowerCase()
                            );

                        if (selectedIndex >= 0) {
                            serviceSelect.selectedIndex =
                                selectedIndex;
                        }

                    }

                    document
                        .querySelectorAll(
                            ".hd-quick-service"
                        )
                        .forEach(item => {
                            item.classList.toggle(
                                "active",
                                item === button
                            );
                        });

                    sortHandymen();
                    renderHandymen();
                }
            );

        });

    document
        .querySelectorAll(
            ".hd-service-card"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const serviceName =
                        button.dataset.serviceCard ||
                        button.textContent.trim();

                    if (serviceSelect) {

                        const options =
                            Array.from(
                                serviceSelect.options
                            );

                        const selectedIndex =
                            options.findIndex(
                                option =>
                                    option.textContent
                                        .trim()
                                        .toLowerCase() ===
                                    serviceName
                                        .toLowerCase()
                            );

                        if (selectedIndex >= 0) {
                            serviceSelect.selectedIndex =
                                selectedIndex;
                        }

                    }

                    sortHandymen();
                    renderHandymen();

                    const handymanGrid =
                        document.querySelector(
                            "#handymanGrid"
                        );

                    if (handymanGrid) {
                        handymanGrid.scrollIntoView({
                            behavior: "smooth",
                            block: "start"
                        });
                    }

                }
            );

        });

    const findHandymanButton =
        document.querySelector(
            "#findHandymanButton"
        );

    if (findHandymanButton) {

        findHandymanButton.addEventListener(
            "click",
            () => {

                const serviceValue =
                    serviceSelect?.value?.trim() || "";

                if (!serviceValue) {
                    alert(
                        "Choose a service first."
                    );
                    return;
                }

                sortHandymen();
                renderHandymen();

                const handymanGrid =
                    document.querySelector(
                        "#handymanGrid"
                    );

                if (handymanGrid) {
                    handymanGrid.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }

            }
        );

    }

    const confirmBookingButton =
        document.querySelector(
            "#confirmBookingButton"
        );

    if (confirmBookingButton) {
        confirmBookingButton.addEventListener(
            "click",
            submitBookingRequest
        );
    }


    document
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const modal =
                        button.closest(
                            ".hd-modal"
                        );

                    if (modal) {
                        modal.classList.remove(
                            "active"
                        );
                    }

                }
            );

        });

}


// ======================================================
// LOGOUT
// ======================================================

function setupLogout() {

    document
        .querySelectorAll(
            "[data-logout]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                async () => {

                    try {

                        await signOut(
                            auth
                        );

                        window.location.href =
                            "../login.html";

                    } catch (error) {

                        console.error(
                            "Logout error:",
                            error
                        );

                    }

                }
            );

        });

}


// ======================================================
// CLEANUP
// ======================================================

window.addEventListener(
    "beforeunload",
    () => {

        if (unsubscribeHandymen) {
            unsubscribeHandymen();
        }

        if (unsubscribeBookings) {
            unsubscribeBookings();
        }

        if (unsubscribeReviews) {
            unsubscribeReviews();
        }

        if (unsubscribeNotifications) {
            unsubscribeNotifications();
        }

        if (unsubscribeConversations) {
            unsubscribeConversations();
        }

    }
);