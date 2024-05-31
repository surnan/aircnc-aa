// backend/routes/api/spots.js

const bcrypt = require('bcryptjs');
const express = require('express');
const router = express.Router();

const { check } = require('express-validator');
const { handleValidationErrors } = require('../../utils/validation');
const { requireAuth, restoreUser, setTokenCookie } = require('../../utils/auth');
const { Spot, Review, Booking, SpotImage, ReviewImage, User } = require('../../db/models');

const avgStarPrecision = 1;
const latlngPrecision = 6;

//Get all Spots
const validateSpot = [
    check('address').exists({ checkFalsy: true }).isString().notEmpty().withMessage('Street address is required'),
    check('city').exists({ checkFalsy: true }).isString().notEmpty().withMessage('City is required'),
    check('state').exists({ checkFalsy: true }).isString().notEmpty().withMessage('State is required'),
    check('country').exists({ checkFalsy: true }).isString().notEmpty().withMessage('Country is required.'),
    check('lat').exists({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('Latitude must be within -90 and 90'),
    check('lng').exists({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('Longitude must be within -180 and 180'),
    check('name').exists({ checkFalsy: true }).isString().isLength({ max: 50 }).withMessage('Name must be less than 50 characters'),
    check('description').exists({ checkFalsy: true }).notEmpty().withMessage('Description is required'),
    check('price').exists({ checkFalsy: true }).isFloat({ min: 0, max: 2000 }).withMessage('Price per day must be a positive number'),
    //Without this entry, errors above enter body but just sit there like an appended string
    //handleValidationErrors searches REQ for validation errors
    //This line/function is the ONLY ".next"
    //which causes flow to bypass route handler code and jump back to app.js
    handleValidationErrors
];


const validateReview = [
    check('review').exists({ checkFalsy: true }).isString().notEmpty().withMessage('Review text is required'),
    check('stars').exists({ checkFalsy: true }).isFloat({ min: 1.0, max: 5.0 }).withMessage('Stars must be from 1 to 5'),
    handleValidationErrors
];

//validator for the spots search query.
const queryParams = [
    check('page', 'isInt({ min: 1 })', 'Page must be greater than or equal to 1'),
    check('size', 'isInt({ min: 1 })', 'Size must be greater than or equal to 1'),
    check('maxLat', 'isFloat({ max: 90.0000000 })', 'Maximum latitude is invalid'),
    check('minLat', 'isFloat({ min: -90.0000000 })', 'Minimum latitude is invalid'),
    check('maxLng', 'isFloat({ max: 180.0000000 })', 'Maximum longitude is invalid'),
    check('minLng', 'isFloat({ min: -180.0000000 })', 'Minimum longitude is invalid'),
    check('minPrice', 'isCurrency({ min: 1.00 })', 'Minimum price must be greater than or equal to 0'),
    check('maxPrice', 'isCurrency({ min: 1.00 })', 'Maximum price must be greater than or equal to 0'),
    handleValidationErrors
];


// Both Helper functions not working?!
const getAvgRating = (reviews) => {
    const totalStars = reviews.reduce((sum, review) => sum + review.stars, 0);
    return reviews.length ? (totalStars / reviews.length).toFixed(avgStarPrecision) : 0;
};

const getPreviewImage = (images) => {
    const previewImage = images.find(image => image.preview);
    return previewImage ? previewImage.url : "No Preview Image Available";
};


router.get('/', queryParams, async (req, res, next) => {
    try {

        let { page = 1, size = 20, minLat, maxLat, minLng, maxLng, minPrice, maxPrice } = req.query;

        page = Math.min(Math.max(parseInt(page), 1), 10);
        size = Math.min(Math.max(parseInt(size), 1), 20);

        const parseNumber = (value) => value ? Number(value) : null;

        minPrice = parseNumber(minPrice);
        maxPrice = parseNumber(maxPrice);
        minLat = parseNumber(minLat);
        maxLat = parseNumber(maxLat);
        minLng = parseNumber(minLng);
        maxLng = parseNumber(maxLng);

        const where = {};

        if (minPrice !== null || maxPrice !== null) {
            where.price = {};
            if (minPrice !== null) where.price[Op.gte] = minPrice;
            if (maxPrice !== null) where.price[Op.lte] = maxPrice;
            if (minPrice !== null && maxPrice !== null) where.price = { [Op.between]: [minPrice, maxPrice] };
        }

        if (minLat !== null || maxLat !== null) {
            where.lat = {};
            if (minLat !== null) where.lat[Op.gte] = minLat;
            if (maxLat !== null) where.lat[Op.lte] = maxLat;
            if (minLat !== null && maxLat !== null) where.lat = { [Op.between]: [minLat, maxLat] };
        }

        if (minLng !== null || maxLng !== null) {
            where.lng = {};
            if (minLng !== null) where.lng[Op.gte] = minLng;
            if (maxLng !== null) where.lng[Op.lte] = maxLng;
            if (minLng !== null && maxLng !== null) where.lng = { [Op.between]: [minLng, maxLng] };
        }

        const spots = await Spot.findAll({
            include: [
                { model: SpotImage },
                { model: Review }
            ],
            // where,
            // limit: size,
            // offset: parseInt(page-1) * size
        });

        const result = spots.map(spot => {

            // // Preview Image
            let previewImage = spot.SpotImages.find(image => image.preview);
            previewImage = previewImage ? previewImage : { url: "No Preview Image Available" }

            // Average Stars
            const totalStars = spot.Reviews.reduce((sum, review) => sum + review.stars, 0);
            const avgRating = spot.Reviews.length ? totalStars / spot.Reviews.length : 0;


            // Create new spot object
            const { id, ownerId, address, city, state, country, lat, lng } = spot;
            const { name, description, price, createdAt, updatedAt } = spot;

            return {
                id,
                ownerId,
                address,
                city,
                state,
                country,
                lat: lat.toFixed(latlngPrecision),
                lng: lng.toFixed(latlngPrecision),
                name,
                description,
                createdAt,
                updatedAt,
                avgRating: avgRating.toFixed(avgStarPrecision),
                previewImage: previewImage.url,
            }
        });

        res.json({ 
            Spots: result,
            page,
            size
        })
    } catch (e) {
        next(e)
    }
});

//Get all Spots by current user
router.get('/current', requireAuth, async (req, res, next) => {

    try {
        const { user } = req;
        const spots = await Spot.findAll({
            include: [
                { model: SpotImage },
                { model: Review }
            ]
        });

        const result = spots.map(spot => {
            // Preview Image
            let previewImage = spot.SpotImages.find(image => image.preview);
            previewImage = previewImage ? previewImage : { url: "No Preview Image Available" }

            // Average Stars
            const totalStars = spot.Reviews.reduce((sum, review) => sum + review.stars, 0);
            const avgRating = spot.Reviews.length ? totalStars / spot.Reviews.length : 0;

            // Create the new spot object
            const { id, ownerId, address, city, state, country, lat, lng } = spot;
            const { name, description, price, createdAt, updatedAt } = spot;

            return {
                id,
                ownerId,
                address,
                city,
                state,
                country,
                lat: lat.toFixed(latlngPrecision),
                lng: lng.toFixed(latlngPrecision),
                name,
                description,
                createdAt,
                updatedAt,
                avgRating: avgRating.toFixed(avgStarPrecision),
                previewImage: previewImage.url,
            }
        })

        res.json({ Spots: spots })
    } catch (e) {
        next(e)
    }
});


//Get details of a Spot from an Id
router.get('/:spotId', async (req, res, next) => {

    try {
        const { spotId } = req.params
        const currentSpot = await Spot.findByPk(spotId, {
            include: [
                {
                    model: Spot,

                },
                {
                    model: Review,
                    attributes: ['stars']
                }, {
                    model: User,
                    as: 'Owner',
                    attributes: ['id', 'firstName', 'lastName']
                },
            ]
        })


        // Average Stars
        const totalStars = currentSpot.Reviews.reduce((sum, review) => sum + review.stars, 0);
        const avgRating = currentSpot.Reviews.length ? totalStars / currentSpot.Reviews.length : 0;

        const { id, ownerId, address, city, state, country, lat, lng } = currentSpot;
        const { name, description, price, createdAt, updatedAt, Owner } = currentSpot;


        const result = {
            id,
            ownerId,
            address,
            city,
            state,
            country,
            lat: lat.toFixed(latlngPrecision),
            lng: lng.toFixed(latlngPrecision),
            name,
            description,
            price,
            createdAt,
            updatedAt,
            numReviews: currentSpot.Reviews.length,
            avgStarRating: avgRating.toFixed(avgStarPrecision),
            SpotImages: currentSpot.SpotImages,
            Owner
        }

        res.json(result)
    } catch (e) {
        next(e)
    }
})

//Create a Spot
router.post('/', requireAuth, validateSpot, async (req, res, next) => {

    try {
        const { user } = req;
        const { lat, lng, address, name, country, city, state, description, price } = req.body;

        const spot = await Spot.create(
            {
                ownerId: user.id,
                address,
                city,
                state,
                country,
                lat,
                lng,
                name,
                description,
                price
            }
        )
        res.status(201).json(spot)
    } catch (e) {
        next(e)
    }
})

//Add Image to Spot
router.post('/:spotId/images', requireAuth, async (req, res, next) => {
    try {
        const { user } = req;
        let { spotId } = req.params;
        let { url, preview } = req.body;

        const currentSpot = await Spot.findByPk(spotId);

        if (!currentSpot) {
            return res.status(404).json({ message: "Spot couldn't be found" })
        }

        if (parseInt(user.id) !== parseInt(currentSpot.ownerId)) {
            return res.status(403).json({ message: "Forbidden" })
        }


        //if preview is invalid, set to false
        preview = preview === "true" ? true : false
        spotId = parseInt(spotId)

        const currentSpotImage = await SpotImage.create({
            url,
            preview,
            spotId
        })

        res.json({
            id: currentSpot.id,
            url,
            preview
        })

    } catch (e) {
        next(e)
    }
})

//Delete Spot
router.delete('/:spotId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const { spotId } = req.params;
        const currentSpot = await Spot.findByPk(spotId);

        if (!currentSpot) {
            res.status(404).json({
                message: "Spot couldn't be found"
            });
        }


        if (userId !== currentSpot.ownerId) {
            return res.status(403).json({
                message: "Forbidden"
            })
        }

        currentSpot.destroy();
        res.json({ "message": "Successfully deleted" })
    } catch (e) {
        next(e)
    }
})

router.put('/:spotId', requireAuth, validateSpot, async (req, res) => {
    try {
        const { spotId } = req.params;

        const userId = req.user.id;

        const { address, city, state, country } = req.body;
        const { lat, lng, name, description, price } = req.body;

        const currentSpot = await Spot.findByPk(spotId);
        if (!currentSpot) {
            res.status(404).json({ message: "Spot couldn't be found" });
        }

        const { ownerId } = currentSpot;

        if (parseInt(userId) !== parseInt(ownerId)) {
            return res.status(403).json({ message: "Forbidden" })
        }

        await currentSpot.update(
            {
                address,
                city,
                state,
                country,
                lat,
                lng,
                name,
                description,
                price
            }
        )
        res.json(currentSpot)
    } catch (e) {
        next(e)
    }
})

//Create a Review for a Spot based on the Spot's id
router.get('/:spotId/reviews', async (req, res) => {
    const { spotId } = req.params;
    const spot = await Spot.findByPk(spotId);
    if (!spot) {
        res.status(404).json({ message: "Spot couldn't be found" })
    }
    const reviews = await Review.findAll(
        {
            where: { spotId: spotId },
            include:
                [
                    {
                        model: User,
                        attributes: ['id', 'firstName', 'lastName']
                    },
                    {
                        model: ReviewImage,
                        attributes: ['id', 'url']
                    }
                ],
        });

    res.json({ Reviews: reviews });
});


//Create a Review for a Spot based on the Spot's id
router.post('/:spotId/reviews', requireAuth, validateReview, async (req, res) => {
    const { spotId } = req.params;
    const { review, stars } = req.body;
    const spot = await Spot.findByPk(spotId);

    if (!spot) {
        res.status(404).json({ message: "Spot couldn't be found" });
    }

    const userId = req.user.id;

    const usersReview = await Review.findOne({ where: { userId: userId, spotId: spotId } });

    if (usersReview) {
        res.status(500).json({ message: "User already has a review for this spot" });
    }

    const spot_review = await Review.create(
        {
            userId,
            spotId,
            review,
            stars: stars
        }
    );

    res.status(201).json(spot_review);
});

module.exports = router;